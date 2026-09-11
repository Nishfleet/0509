# Lane evidence — claim/issue-2861

Issue: Nishfleet/0509#2861 — public `/timeline/allbirds.com` showed the offer
price alternating £50 → $100 daily, flagged "material" each time.

## Root cause (verified against the stored captures)

The public page-text artifacts are fetchable; replayed all five:

- `landing-pages/2026-09-05/e27eec45…html` → price `£50`
- `landing-pages/2026-09-06/611b482e…html` → price `$100`
- `landing-pages/2026-09-07/7faf9901…html` → price `£50`
- `landing-pages/2026-09-08/9c4af38d…html` → price `$100`
- `landing-pages/2026-09-11/9ee0cbb6…html` → price `£50`

Every capture — £-day and $-day alike — declares the SAME shop currency:
`"currencyCode":"USD"`, `"currency":"USD"`, `currency = {"active":"USD"}`,
`data-currency="USD"`. Zero GBP declarations anywhere.

The £-day renders add exactly one `£`-marked string: a UK-geo announcement-bar
slide, "Free shipping and returns on orders over £50.", which sits BEFORE
every real price in flattened text order. `pickPrice` returned the first
`[$€£]` match in text order, so the stored `price_text` flipped with
whichever geo-variant of the announcement bar rendered that day. The shop's
price never changed.

## Change

- `app/lib/landing-page-signals.server.ts` (lp-signals-v7):
  `pickDeclaredCurrency(rawHtml)` majority-votes the page's declared
  currency over `currencyCode`/`priceCurrency`/`currency` JSON fields,
  `currency = 'USD'` assignments, Shopify's `{"active":"USD"}` money object,
  and `og:price:currency`/`product:price:currency` meta tags (allowlisted
  ISO codes only). `pickPrice` gains a preference pass: first candidate
  whose marker is consistent with the declared currency, keeping the
  existing pattern-priority order. When nothing is declared — or no
  candidate matches it — the historical first-match behaviour applies
  unchanged, so the anchor can disambiguate but never blank a price.
- `tests/integration/allbirds-price-currency-stability.test.ts`: fixtures
  mirroring the stored captures (geo announcement bar ahead of USD product
  prices, identical USD declarations) — the alternating UK/US sequence now
  extracts `$100` every time and the built ledger carries no price
  transition. Edge cases pinned: GBP shop keeps £, declaration-free page
  keeps first-match, lone-£ price on a USD page is not blanked, a genuine
  declared-currency change is followed.
- Version literals bumped `lp-signals-v6` → `v7` in `data.server.test.ts`,
  `landing-pages.browser-run.test.ts`,
  `landing-page-pipeline-instrumentation.test.ts` (same sweep the v6 bump
  did in d79f383c8).

## Proof

- RED (replayed before the fix, real stored artifacts):
  `extractLandingPageSignals` over the five captures →
  `£50, $100, £50, $100, £50` — the live alternation, reproduced.
- GREEN (same replay after the fix): `$100` on all five;
  `pickDeclaredCurrency` → `USD` on all five.
- `npx vitest run tests/integration/allbirds-price-currency-stability.test.ts
  --project node` → 7 passed.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 359 files / 4664 tests passed.
- Relation: #2742 stays the stored-row reclassification process; this PR
  stops new unstable rows at extraction. No history rewrite here.
- Typecheck deferred to CI per fleet-ops#4891 worker memory budget.

## Follow-up filed

- The same alternating captures also flip the CTA (`Shop Now` ↔ `Sign Up`),
  a sibling noise source this issue does not cover — filed as a new issue.
