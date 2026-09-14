Closes #3476

## What was wrong

`node scripts/check-ads-timeline-links.mjs` went red on production flagging `/brands` (puma.com, uniqlo.com, levi.com) and `/ads/asos.com` + `/ads/boat-lifestyle.com` for missing `/timeline/<domain>` links — then self-healed on later runs. Two mechanisms produce that exact symptom:

1. **Designed edge staleness.** `/brands` and `/ads/:domain` serve worker edge-cached HTML for up to ~65 minutes (5-min TTL + `EDGE_STALE_WINDOW_SECONDS = 3600` in `workers/edge-cache.ts`). `sitemap.xml` is never edge-cached, so the sweep's expected set is always fresh while asserted pages can be a designed-stale copy. A domain that qualified inside the window — e.g. puma/uniqlo/levi during the 127→286 `/ads` growth — is absent from the stale copy and gets flagged. No page-code change can fix that skew; it is the accepted #3247 posture.
2. **Silent loader degrade.** `loadIndexableTimelineEntries` reads up to `SITEMAP_TIMELINE_READ_LIMIT` (500 × 200 = 100k) `landing_page_snapshot` rows with a per-row `EXISTS(ad_observation)` — the heaviest read in a public render. A transient failure → catch → `console.warn` only → a link-less render that the edge cache then serves for up to ~65 min. One hiccup becomes an hour of missing links, with no durable record of why. asos.com has proof-complete snapshots back to 2026-04-14, so its missing link could not be staleness — it was a degraded render held in cache.

## What changed

- `app/lib/sitemap.server.ts` — `loadIndexableTimelineEntries` retries the bounded read **once** on non-schema errors (missing-table still degrades immediately to the static set). A single hiccup can no longer strip every timeline cross-link from a render that then gets cached.
- `app/lib/ads-internal-links.server.ts` — both loader catches now `await reportError(...)` into the `error_report` sink (issue #2988): `indexable_ads_links_read_failed` / `indexable_timeline_domains_read_failed` under route `loader.ads_internal_links`. The degrade is now durable and visible via `/api/observability/error-reports` and `/api/health/deep` — acceptance bullet 2.
- `scripts/check-ads-timeline-links.mjs` — asserted `/ads` and `/brands` fetches carry a per-run `__sweep=<ts>` query param. Both cache layers key on the full URL, so the sweep now asserts the **current origin render** instead of racing the serve-stale window. The sitemap fetch is unchanged (never edge-cached).
- Tests: `tests/sitemap.server.test.ts` gains retry-then-success and retry-exhausted cases; `tests/ads-brand-page.internal-links.test.ts` gains `reportError` wiring assertions for both helpers.

## Verification

- `node scripts/check-ads-timeline-links.mjs` before the fix: **exit 1** — flagged `/ads/asos.com` and `/ads/boat-lifestyle.com` while both links were present on immediate re-fetch (the flagged copies were stale/degraded cache entries).
- `node scripts/check-ads-timeline-links.mjs --verbose` after the fix: **exit 0** — `sitemap: 286 /ads pages, 29 /timeline pages` → `OK: all 286 indexable /ads pages link their /timeline; 29 qualifying /timeline pages linked from /brands.` (against production, before this diff deploys — proving the origin render was already correct and the reds were cache/degrade artifacts.)
- `npx vitest run --configLoader runner --project node tests/ads-brand-page.internal-links.test.ts tests/sitemap.server.test.ts --reporter=dot` → 103/103 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main --reporter=dot` → 369 files / 4592 tests pass.
- `sgscan --base origin/main` → 0 findings (exit 0).
- `crgate` → unavailable: `CodeRabbit is not signed in on this machine` (exit 3) — local gate skipped, named per failed-command rule.

run-proof: `node scripts/check-ads-timeline-links.mjs --verbose` exit 0 on production after the change; vitest `--changed origin/main` 4592 tests green.

research: no new `bin/` file, no new mechanism — reuses `reportError` (issue #2988 sink), the existing sitemap read, and a query-param cache-bust (same lever as `scripts/provider-bakeoff.lib.mjs`'s `?fresh=live`).

help-first: no new script/binary; the sweep change is an in-place edit of the existing `check-ads-timeline-links.mjs`.

## Reviewer round

Seat: `cursor/cursor-grok-4.6-high` (first usable of `senior_seats_in_order`; `bin/fleet-review-arm-check` exit 0).

Reviewer verdict: **diff is clean — no CRITICAL or HIGH issues; do not block.** Acceptance holds; retry prevents a single hiccup poisoning a ~65-min cached render; `reportError` never throws so a broken sink cannot turn a degrade into a 500; `cacheKeyUrl` keys on the full URL so `__sweep=<ts>` genuinely misses both cache layers; touched tests 103/103 pass.

Adjudication:

- MEDIUM — each sweep now origin-renders ~29 asserted `/ads` pages + `/brands` and stores throwaway `__sweep` keys: **Noted.** Bounded per run, the sweep runs on demand, and a bypass-header that skips match *and* store would be new machinery for a light fix — disproportionate.
- LOW — non-200 `/brands` still skips the hub check and can exit 0: **Noted** (pre-existing, unchanged by this diff).
- LOW — test file keeps top-level imports alongside post-`doMock` dynamic imports: **Noted** (existing file convention, harmless).
