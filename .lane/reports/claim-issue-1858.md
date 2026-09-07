# Lane evidence — claim/issue-1858

**Issue:** Nishfleet/0509#1858 — Progressive/streamed search results to eliminate 16–25s opaque spinner
**Branch:** `claim/issue-1858`
**Date:** 2026-09-06

## What was already shipped

The streaming SSR, progressive skeleton, and aggressive per-domain caching were
already landed by #951 (warming + revalidation), #1482 (three-tier badges +
streaming regression test), and #1851 (tier-model canary assertions):

- `app/lib/ad-source.server.ts` serves partial/stale cache entries immediately
  with `discoveryProgress: "warming"` so the first SSR payload paints rows
  while the background capture continues.
- `app/lib/search-v2.server.ts` `applySearchV2PostFilter` keeps ALL candidate
  tiers (verified / likely / unmatched) in `result.ads` — it never drops
  non-verified candidates to an empty page.
- `app/routes/search.tsx` renders visible rows during warming with
  `aria-live="polite"` progressive status, tier counts, and tier badges.
- `tests/search/streaming-three-tier.test.tsx` asserts first-card <5s, all
  three badges, and the zero-verified non-empty state.

## What this PR adds

The missing deliverable: the named `npm run canary:search-stream` verdict
script (issue accept #4).

- `scripts/search-stream-canary.mjs` — reuses `runLiveVerification`,
  `summarizeResults`, `evaluateTermination`, the rate limiter, and
  `parseSearchResponseHtml` from `bet2-live-verification.mjs` verbatim. No
  parallel parser, no second limiter. Adds `evaluateStreamTermination` which
  surfaces the three issue #1858 metrics: `p95_first_card_ms < 5000`,
  `dead_end_count = 0`, `verified_share >= 0.8`. Exits non-zero when any
  streaming check trips.
- `tests/search-stream-canary.test.ts` — 11 unit tests covering: the 25-domain
  cohort, threshold constants, pass/fail for each of the three metrics, null
  p95 (all-warming), demo-sourced warnings, `runSearchStreamCanary` end-to-end
  with a mock fetch, and `formatStreamSummary` output format.
- `package.json` — `canary:search-stream` script entry.
- `tsconfig.node.json` — include entry for the new script (matches the
  existing canary script pattern).

## Verification

```
$ ./node_modules/.bin/vitest run --configLoader runner --project node tests/search-stream-canary.test.ts
 Test Files  1 passed (1)
      Tests  11 passed (11)

$ ./node_modules/.bin/vitest run --configLoader runner --project node
 Test Files  593 passed (593)
      Tests  7040 passed (7040)

$ node scripts/search-stream-canary.mjs --help
Usage: npm run canary:search-stream [-- --base-url=URL] [-- --json] [-- --spacing-ms=N]
...exits 0

$ npm run typecheck
# 24 errors — ALL pre-existing in e2e/ and playwright.config.ts
# 0 errors in scripts/search-stream-canary.mjs or tests/search-stream-canary.test.ts
```

## Scope compliance

- No D1 schema changes.
- No workflow edits.
- No gate-owned path edits.
- Rollback: revert this commit (removes the canary script + test + package.json entry).
