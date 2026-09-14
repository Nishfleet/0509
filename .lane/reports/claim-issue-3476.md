# Lane evidence — issue #3476 (check-ads-timeline-links red on production)

## Root cause (two mechanisms, one symptom)

1. **Designed edge staleness.** `/brands` and `/ads/:domain` serve worker
   edge-cached HTML for up to ~65 min (workers/edge-cache.ts: 5-min TTL +
   `EDGE_STALE_WINDOW_SECONDS = 3600`). `sitemap.xml` is never edge-cached —
   the sweep's expected set is always fresh while asserted pages can be stale.
   A domain that qualified inside the window (new /ads page or new /timeline)
   is absent from the stale copy → false "missing link". Explains the /brands
   misses for puma.com/uniqlo.com/levi.com during the 127→286 /ads growth.
2. **Silent loader degrade.** `loadIndexableTimelineEntries` reads up to
   `SITEMAP_TIMELINE_READ_LIMIT` (500 × 200 = 100k) `landing_page_snapshot`
   rows with a per-row `EXISTS(ad_observation)` — the heaviest read in a
   public render. A transient failure → catch → `console.warn` only →
   link-less render → edge-cached ~65 min. One hiccup looks like a persistent
   regression. Explains /ads/asos.com + /ads/boat-lifestyle.com (indexable
   for weeks — staleness cannot explain those).

## Fix

- `app/lib/sitemap.server.ts` — `loadIndexableTimelineEntries` retries the
  bounded read once on non-schema errors before propagating.
- `app/lib/ads-internal-links.server.ts` — both loader catches now write
  `reportError` rows (`indexable_ads_links_read_failed`,
  `indexable_timeline_domains_read_failed`) → visible via
  `/api/observability/error-reports` + `/api/health/deep`.
- `scripts/check-ads-timeline-links.mjs` — asserted page fetches carry a
  per-run `__sweep=<ts>` param, bypassing both cache layers (keys include the
  full URL) so the sweep asserts the current origin render.

## Evidence

- `node scripts/check-ads-timeline-links.mjs` BEFORE fix: exit 1,
  `/ads/asos.com` + `/ads/boat-lifestyle.com` flagged missing their timeline
  link while both were present on the live page on immediate re-fetch.
- `/timeline/asos.com` shows captures from 2026-04-14 onward → indexable for
  months → the observed gap could not be qualification staleness; it was a
  degraded/hiccuped render held by the edge cache.
- `node scripts/check-ads-timeline-links.mjs --verbose` AFTER fix: **exit 0**
  against production (`sitemap: 286 /ads pages, 29 /timeline pages` →
  `OK: all 286 indexable /ads pages link their /timeline; 29 qualifying
  /timeline pages linked from /brands.`).
- `npx vitest run --configLoader runner --project node
  tests/ads-brand-page.internal-links.test.ts tests/sitemap.server.test.ts`
  → 103/103 pass (incl. new retry + error_report tests).
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 369 files / 4592 tests pass.

## Notes

- The remaining designed-staleness window (≤ ~65 min) is the accepted
  edge-cache posture (#3247); the sweep now verifies origin truth instead of
  racing it.
- Fleet-infra side observation: `fleet-merged-pr-close.service` showed failed
  in `systemctl --user list-units --state=failed`; its finding (dead
  conflicting fleet-ops PR #6768) was already closed — the unit's next tick
  goes green on its own.
