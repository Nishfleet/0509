## reccos: Stop showing every visitor on Earth a Nykaa proof brief

Closes #2281.

### What changed

The homepage proof brief and the "Try with <brand>" CTA now pick the featured
demo brand by the visitor's home market instead of hardcoding Nykaa for every
visitor on Earth.

- `app/lib/public-proof.server.ts`: new `featuredWebsiteForVisitorCountry(country)`
  returns `nike.com` for US/EU/unknown visitors and `nykaa.com` for Indian
  visitors — both from the existing flagship set (`DEMO_BRAND_PAGE_DOMAINS`),
  so the featured brand is always a real tracked brand with a live `/ads/:domain`
  page. `loadPublicProofBrief` reads the featured brand's cache row for the
  visitor country.
- `app/routes/marketing.tsx` (the source of the `$locale._index.tsx` route):
  the loader resolves the visitor country exactly like the `/ads/:domain`
  loader and passes the featured domain through; the "Try with <brand>" CTA,
  the featured `/ads` link, and the free-preview search target all use the
  same country-chosen domain.

The count-parity contract (issue #1468) is preserved: the home brief and the
linked `/ads/:domain` page still read the same discovery-cache row for the same
visitor, so they can never report different totals for the same brand on the
same day.

### Verification

Real run, from the rebased `origin/main..HEAD` in the claim worktree:

- `npm test` (full): **659 node files / 7864 tests passed**, **51 worker files /
  247 tests passed** — including the updated `homepage-vs-brandpage-count-parity`
  suite (nike.com parity for a DE visitor, plus the new country-based featured
  brand tests), `marketing-pricing-latency`, `ads-internal-links`,
  `funnel-measurement`, and `marketing-rebuild` suites.
- Targeted re-run of the 5 touched test files after rebasing onto latest
  `origin/main`: **101 tests passed**.

run-proof: npm test green (7864 node + 247 worker tests) on claim/issue-2281
rebased onto origin/main; targeted 5-file re-run 101/101 green.

net-positive-because: the diff is net-positive only because it adds the
country-based featured-brand selection (a new function + its tests) and
updates the marketing loader/CTA to thread the visitor country through —
no new machinery, no new organ, no new mechanism.

### Acceptance

- US visitor (`cf-ipcountry: US` → "United States") → featured brand `nike.com`,
  CTA "Try with Nike".
- IN visitor (`cf-ipcountry: IN` → "India") → featured brand `nykaa.com`,
  CTA "Try with Nykaa".
- Claim-table parity test (`homepage-vs-brandpage-count-parity`) still passes
  per brand.
