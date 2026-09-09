## Summary

EPIC #1367 Q3: surface the `website_page_*` watch events (emitted by #1383, merged in #1994/#2011) to the customer end-to-end. The event types already had display labels and default importance; this wires the surfacing path.

- **Watchlist detail "What changed" tab**: `website_page_added`/`removed`/`changed` render as change records with the page URL (in the event title/summary), a customer-facing changed-field label (`visibleText`/`offerPrice`/`cta` → "Visible text" / "Offer / price" / "Call to action"), and the before/after diff token via `change-mark.ts` **reused as-is** (it already reads `metadata.from`/`metadata.to`).
- **Digests**: `website_page_*` is its own material `"website"` class in `change-intelligence.ts`; the materiality clause surfaces `tracked pages changed (N)`; per-event next-action recommendations follow the same truth rules as ad/landing events.
- **Instant alerts**: `website_page_*` is an instant-alert class in `delivery-policy.server.ts` — it clears the same importance gate as a landing change (below-gate stays quiet). Emitted events carry an importance score (added/removed 80, changed 82) that clears the balanced gate (75) without spamming a quiet workspace (gate 90). Idempotency keys ride the existing instant-alert delivery path unchanged.
- **Honest coverage**: `buildWebsiteCoverageLabel` already surfaces "X of Y known pages watched" on the watchlist detail (landed on main in 544bda91). No false "whole site" claim is introduced.

`change-mark.ts` is reused as-is. No new diff logic. No new machinery (no new units/timers/workflows). No migrations touched.

## Acceptance

- [x] website_page events render in the watchlist detail tabs with page URL, changed field, and before/after diff token via change-mark.ts (reused as-is)
- [x] website_page events included in digests under the same materiality/reviewer/next-action truth rules as ad events
- [x] alertable website_page events route through the existing instant-alert delivery path with idempotency keys
- [x] buildWebsiteCoverageLabel surfaces an honest "X of Y known pages watched" — never a false "whole site" claim (pre-existing on main)

## Verification

Ran on `claim/issue-1384` (rebased onto `origin/main` @ d6477b86):

- `npm run typecheck` → exit 0 (cf-typegen + react-router typegen + tsc -b).
- `npx vitest run --project node` → 634 files, 7509 tests pass.
- `npx vitest run --project workers` → 41 files, 204 tests pass (incl. `tests/integration/website-page-change-emission.integration.test.ts` against real D1 migrations).
- Targeted: `tests/competitor-site-monitor.server.test.ts`, `tests/delivery-policy.test.ts`, `tests/digest-ranking.test.tsx` (65 tests), `tests/event-change-green-mark.test.tsx`, `tests/watchlist-change-feed.test.tsx`, `tests/digest-intelligence.test.ts` (47 tests) — all pass.

run-proof: `npx vitest run --project node` (634 files / 7509 tests, exit 0) and `npx vitest run --project workers` (41 files / 204 tests, exit 0) both green on the rebased branch.

## Review

Reviewer seat: `cursor/cursor-grok-4.6-high` (resolved via `find_senior_seat`; `fleet-review-arm-check` exit 0). One round.

- **Act on**: extracted the `80/80/82` website_page importance values into a single shared `WEBSITE_PAGE_EVENT_IMPORTANCE` constant in `digest-rerank.ts`, sourced by both the direct emission path (`competitor-site-monitor.server.ts`) and the evaluator path (`watch-event-evaluator.server.ts`) so the two can never drift; fixed the tab-indented `WEBSITE_PAGE_EVENT_TYPES` block to the file's 4-space convention. Typecheck + affected tests re-run green.
- **Consider**: rendering the before/after token only in the non-`DiffPlate` branch is a fragile coupling if a `website_page_*` event ever carries a succeeded proof capture. website_page events are scan-backed and never produce a proof capture today, so this is out of scope to harden now; noted for a future change.
- **Dismissed-with-reason**: `websitePageChangedFieldLabel`'s `"Page content"` fallback uppercases to `"PAGE CONTENT"` in `diffFieldLabel`. The fallback is honest and only reachable for an unknown `metadata.field`; acceptable.

Closes #1384