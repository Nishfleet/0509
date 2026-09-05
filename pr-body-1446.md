## What changed

Alias brand pages (the natural base domain a buyer types — `ridge.com`,
`oura.com`) were serving a competing indexable URL next to the populated
product page (`ridgewallet.com` / `ouraring.com`). `ridge.com` showed 2
verified ads while `ridgewallet.com` had 24, and `oura.com` never 301'd to the
populated, indexable `ouraring.com`. This split the brand's verified ads and
link equity and self-competed for the same query in Google.

This PR consolidates each brand onto its populated canonical page:

1. **Canonical alias registry + resolver** (`app/lib/brand-page.server.ts`):
   `BRAND_PAGE_CANONICAL_ALIASES` maps `ridge.com → ridgewallet.com` and
   `oura.com → ouraring.com`. Each entry is grounded in the existing #1428
   folded stem-extension identity (`hostnamesMatchBrandStemExtension`:
   ridgewallet folds to ridge + "wallet", ouraring to oura + "ring") — a
   curated table is required because a loader cannot enumerate a stem's
   unknown extensions at request time. No new classifier; reuses #1428.
2. **Route loader** (`app/routes/ads.$domain.tsx`): a requested alias domain
   301-redirects to its canonical page **only when that page is actually
   populated**. If the canonical page is empty it falls through and the alias
   renders normally — the anti-thin-content guard keeps a weak alias page
   noindex (criterion 4); we never redirect to an empty target.
3. **Attribution** (`adIsBrandOwned` / `adHasVerifiedDomainLink`): a creative
   landing on the brand's alias host is counted as brand-owned / verified on
   the canonical page (criterion 2), so the verified set never splits by
   landing-host.
4. **Sitemap** (`app/lib/sitemap.server.ts`): alias domains are excluded —
   once the route 301s them they are no longer distinct indexable URLs
   (criterion 3).

Render/route logic only: no `migrations/**` change, no D1 column or table.

net-positive-because: the +475 lines are the new route-level regression test
(`tests/ads-alias-canonical-redirect.test.ts`, 321 lines) plus the alias
resolver/attribution logic that closes the split-URL defect; the only
production-code additions are the curated two-row alias table and the
redirect/attribution branches that reuse the existing #1428 identity.

## Verification

- `typecheck`: `npx tsc -b` → exit 0.
- New route-level test (the issue's verify command):
  `npx vitest run --configLoader runner --project node tests/ads-alias-canonical-redirect.test.ts` → 7 passed.
- Full node project suite (what CI runs):
  `npx vitest run --configLoader runner --project node` → 570 files, 6829 tests passed.
- Affected suites: `ads-brand-page.route.test.ts`, `ads-brand-page.signals.test.ts`,
  `ads-brand-page.render.test.tsx`, `ads-brand-page-indexability.test.ts`,
  `sitemap.server.test.ts` → all passed.
- Integration (criterion 2 against real D1):
  `npx vitest run --configLoader runner --project workers tests/integration/ads-brand-owned.integration.test.ts` → 4 passed.
- `sgscan --base origin/main` → no new security findings.

Live-production `curl` on `/ads/oura.com` / `/ads/ridge.com` is not verifiable
from this worker (no deploy permission; `main` protected); the route-level test
is the end-to-end run for this logic change.

Closes #1446
