# Lane 1 evidence: four rival comparison pages

**Branch:** `0509-lane1-compare-rivals`
**Item:** Ship `/compare/{visualping,spyland,pulzifi,foreplay}` honest comparison pages

## Summary

Added four public comparison pages matching the existing MagicBrief / Meta Ad Library pattern:

- `/compare/visualping` — Five to Nine vs Visualping
- `/compare/spyland` — Five to Nine vs Spyland
- `/compare/pulzifi` — Five to Nine vs Pulzifi
- `/compare/foreplay` — Five to Nine vs Foreplay

Wired routes, sitemap/SEO (`SITEMAP_PATHS`, `STATIC_CHANGEFREQ_PRIORITY`), `LLMS_PAGE_DETAILS`, public HTML cache headers (`PUBLIC_CACHEABLE_HTML_PATHS`), footer compare links, and test registry assertions.

## Files changed

- Created: `app/routes/compare.{visualping,spyland,pulzifi,foreplay}.tsx`
- Edited: `app/routes.ts`, `app/lib/seo.ts`, `app/lib/public-markdown.ts`, `workers/security-headers.ts`, `app/components/marketing-footer.tsx`
- Tests: `customer-claim-surface-registry`, `worker-security-headers`, `funnel-seo`, `marketing-nav`, `global-first-examples`

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | pass |
| `npm run build` | pass |
| Related tests (funnel-seo, seo, public-markdown, etc.) | 58 passed |
| Dev server (E2E_TEST_MODE=1, port 5173) | all four pages 200 |
| Page titles | correct for each rival |
| Cache headers | `cache-control: public, max-age=300`, `vary: cookie` |
| Sitemap | four new `<loc>` entries |
| Footer | four new compare links |

**Note:** Full `npm test` reports 27 failures in monitoring-fanout / workspace-seats suites (`column index out of range` SQLite errors). These appear pre-existing on the branch base and unrelated to this marketing-only diff; all compare-page-specific tests pass.

## PR

https://github.com/Nishfleet/0509/pull/897
