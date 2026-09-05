## What

Resolves the duplicate-content SEO defect on the two `/compare/*` pairs from #1481 that shipped in the sitemap at identical priority (0.7) with no canonical disambiguation:

- `/compare/visualping` → `/compare/visualping-ad-library`
- `/compare/foreplay` → `/compare/foreplay-spyder`

The more specific URL (the one naming the narrower buyer intent) wins each pair, as the issue's `accept` section specifies.

The generic loser of each pair now:
- keeps its registered route and still renders HTTP 200 (no 404 — existing backlinks and `/switch/*` cross-links keep working),
- carries a `rel="canonical"` pointing at the specific sibling,
- is dropped from `sitemap.xml`, from the `/compare` hub, and from the marketing footer nav,
- no longer cross-links to/to-from its sibling on the winner pages (the two pages are consolidated into one SERP target).

Added `app/lib/seo.ts::COMPARE_CANONICAL_TARGETS` (loser→winner map) so the pair relationship is data, not prose. Updated `switch-pages.ts` to point Visualping's `relatedComparePath` at the winner.

## Regression test

New `tests/seo/compare-canonical.test.ts` parses the generated sitemap, asserts:
1. only the canonical winner of each pair is listed (losers absent),
2. every sitemap `/compare/*` URL is unique with no duplicate sibling prefix,
3. each loser carries the winner canonical, stays route-registered, and renders a real page (H1).

Updated the sitemap / hub / footer / switch / money-page expectations in the existing suite.

## Verification

```
npx vitest run tests/seo/compare-canonical.test.ts        # 3 passed
npx vitest run tests/sitemap.server.test.ts tests/seo.test.ts tests/compare-hub.route.test.ts tests/customer-claim-surface-registry.test.ts   # 83 passed
npx vitest run tests/funnel-seo.test.ts                    # 10 passed
npx vitest run tests/switch-pages.route.test.ts tests/marketing-nav.test.ts tests/ads-internal-links.test.ts tests/new-compare-pages.route.test.ts tests/compare-structured-data.test.ts tests/compare-remaining-screenshot-copy.test.ts tests/global-first-examples.test.ts   # 84 passed
NODE_OPTIONS=--max-old-space-size=4096 npx tsc -b          # exit 0
sgscan                                                  # exit 0, no new findings
```

Local sitemap evidence (the generated /sitemap.xml now lists one URL per pair):

```
# /compare/visualping and /compare/foreplay absent; specific winners present
grep -oE '<loc>[^<]+/compare/(visualping|foreplay)[^<]*</loc>' <generated sitemap>
```
(from `publicSeoFileForPathname("/sitemap.xml")`, asserted by `compare-canonical.test.ts`).

Post-deploy production check (per issue `verify`): `curl -sS https://0509.io/compare/foreplay-spyder -o /dev/null -w "%{http_code}"` → 200 and `curl -sS https://0509.io/sitemap.xml | grep -oE 'compare/(visualping|foreplay)' | sort -u | wc -l` → 2. Not run here because this PR is not yet merged/deployed; the run-proof is the local sitemap test.

net-positive-because: consolidates each near-identical /compare pair into one canonical SERP target so 0509 stops competing with itself for the "Visualping alternative" / "Foreplay alternative" SERPs; no behavior regression (losers keep serving 200).

loose-ends-canary: pr:nishfleet/0509#1481 canonicalize-compare-duplicates

Closes #1481
