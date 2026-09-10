## What and why

Every visitor's featured proof example on the compare pages named the Indian
beauty brand Nykaa ("See Nykaa's ads on Five to Nine"), while the ICP is global
growth teams whose buyer knows the sneaker/sport brands. The featured-proof
loader (`pickFeaturedAdsInternalLink`, fed by `compareAdsExampleLoader`) pinned
`nykaa.com` as the first preference.

Per the binding judge edits (issue #2314), the featured-proof loader now
prefers the newest fresh capture from Footlocker, New Balance, Adidas, Nike,
JD Sports **in that order** and falls back to Nykaa only when none of them is
fresh. Fresh = the same capture-age window the brand pages already use
(`BRAND_PAGE_FRESH_FOR_INDEXING_MS`, 7 days): `loadIndexableBrandPageEntries`
only returns captures within that window, so any priority brand present is a
fresh capture and an absent one means stale/missing. No country→brand mapping
is introduced — the same fixed order serves every visitor.

The compare routes already call the featured-proof loader (edit #5):
`compare.meta-ad-library`, `compare.pulzifi` and `compare.spyland` wire
`compareAdsExampleLoader`, and `CompareAdsExampleLink` renders the resolved
brand — so no data-loading change to the compare routes was needed. The CTA
updates automatically for every visitor who lands on a fresh sneaker capture.

## Acceptance

- Route test mocking `CF-IPCountry: US`, and one with no header, show a
  non-Nykaa brand (`footlocker.com` / `adidas.com`) when a fresh sneaker-brand
  capture exists; Nykaa appears only in the all-stale fixture.
- The priority order is exercised: Footlocker > New Balance > Adidas > Nike >
  JD Sports.
- Nykaa is returned only as the fallback when no fresh priority brand is
  present.
- Regression guard: a caller-pinned priority sneaker brand (the homepage's
  country-derived nike) is honored so the proof brief and the featured link
  never disagree on the home surface — this addresses the reviewer's single
  should-fix finding without editing `marketing.tsx` (out of ticket scope).

## Verification

Real test runs (`npx vitest run --configLoader runner --project node`):

- `tests/ads-internal-links.test.ts` — **30 passed** (sneaker order, Nykaa
  fallback, pinned-sneaker guard, and the `compareAdsExampleLoader` route test
  with `CF-IPCountry: US`, no header, and the all-stale fixture).
- Broad affected slice (17 files: internal-links, homepage*, marketing-*,
  compare-*, switch-search-crosslink, breadcrumb): **162 passed**.
- `tests/homepage-vs-brandpage-count-parity.test.tsx` still passes (count
  parity is untouched — the reorder does not affect the `/api/demo-proof` /
  `/ads/:domain` loaders).

## Review adjudication

Reviewer seat: `cursor/cursor-grok-4.6-high` (senior seat #3121).

- **Act on** — 1: the shared helper let a lower-priority sneaker brand displace
  the homepage-pinned `featuredDomain` (brief/CTA vs featured-link divergence).
  Fixed in `pickFeaturedAdsInternalLink` by honoring a caller-pinned priority
  brand first; regression test added.
- **Consider** — none.
- **Noted** — the `CF-IPCountry` header is inert in `compareAdsExampleLoader`
  (it never reads it), consistent with the binding judgment that the mapping is
  not a worker decision; the no-header test provides the real coverage.
- **Dismissed-with-reason** — homepage count-parity would break (rejected: that
  test compares `/api/demo-proof` and `/ads/:domain` loaders, not
  `pickFeaturedAdsInternalLink`); `featuredWebsiteForVisitorCountry` /
  `PUBLIC_PROOF_FEATURED_WEBSITE` misused (rejected: unaffected pure helpers).

net-positive-because: the +172 lines are overwhelmingly new tests (sneaker-order
selection, Nykaa fallback, pinned-sneaker guard, and the `compareAdsExampleLoader`
route test required by the issue's accept); the production change is a ~45-line
selector in `app/lib/ads-internal-links.ts`. The tests are the durable proof of
the behavioral contract the issue demands.

## run-proof

- Units: 30 vitest cases in `tests/ads-internal-links.test.ts` (node project),
  plus 162 cases across the 17-file affected slice.
- No schedule/timer/workflow shipped — this is a selector behavior change with
  route- and unit-level proof only.

Closes #2314