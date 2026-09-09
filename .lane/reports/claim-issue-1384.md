# Lane evidence — claim/issue-1384 (issue #1384)

EPIC #1367 Q3: surface website_page_* events in UI, digests, instant alerts.

## Acceptance bullets

1. Watchlist detail tabs render website_page events with page URL, changed
   field, and before/after diff token via change-mark.ts (reused as-is).
2. website_page events included in digests under the same
   materiality/reviewer/next-action truth rules as ad events.
3. Alertable website_page events route through the existing instant-alert
   delivery path with idempotency keys.
4. buildWebsiteCoverageLabel surfaces an honest "X of Y known pages watched".

## Verification

- `npm run typecheck` -> exit 0 (cf-typegen + react-router typegen + tsc -b).
- `npx vitest run --project node` -> 634 files, 7509 tests pass (full suite).
- `npx vitest run --project workers` -> 41 files, 204 tests pass (incl.
  tests/integration/website-page-change-emission.integration.test.ts against
  real D1 migrations).
- Targeted: tests/competitor-site-monitor.server.test.ts,
  tests/delivery-policy.test.ts, tests/digest-ranking.test.tsx (65 tests),
  tests/event-change-green-mark.test.tsx, tests/watchlist-change-feed.test.tsx,
  tests/digest-intelligence.test.ts (47 tests) — all pass.
- Full `node` + `workers` projects are green on the rebased branch; no
  pre-existing failures remain.

## Dependency

Depends on #1383 (event emission), closed by merged PRs #1994 and #2011
on 2026-09-08. website_page_* events are now emitted in production main.
