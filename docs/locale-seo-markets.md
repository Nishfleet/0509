# Sneaker-resale locale markets (issue 1154)

Zero-spend SEO slice. Product UI stays English. These pages exist so search in
the customer's language can find Five to Nine. Paid ads are out of scope; any
ads proposal is a money decision for Nish.

## The three markets

Picked from published market size and from the language of competing tools, not
from a gut feel.

1. **German (`/de/sneaker-resale`)** — Europe is Meta's second-largest revenue
   region after US & Canada (Meta FY2025 geographic split: Europe $46.57B,
   US & Canada $78.87B). Germany is the largest DACH economy. Foreplay,
   MagicBrief, and AdSpy market in English; a German query for competitor-ad
   monitoring does not land on a segment page from those products.
2. **Japanese (`/ja/sneaker-resale`)** — Asia-Pacific is the fastest-growing
   sneaker-resale region (DataM Intelligence: global resale $10.6B in 2025,
   APAC projected 20.6% CAGR 2026–2035) and Meta's largest region by users.
   Japanese is a hard language moat. US spy tools do not ship 日本語 landing
   pages for this job.
3. **Brazilian Portuguese (`/pt-br/sneaker-resale`)** — Rest of World is
   already $21.71B of Meta FY2025 revenue. Brazil is a large Meta ads market
   and a growing resale scene. US tools ignore Portuguese search.

English `/sneaker-resale` is the cluster default (`hreflang="en"` and
`x-default`).

China is a large APAC resale market and is deliberately out: Five to Nine
reads the Meta Ad Library, not Douyin / WeChat.

## Success metric

Retention-weighted, not raw traffic: an organic signup from a locale page
that still has a watchlist seven days later.

This slice records anonymous `funnel_locale_segment_view_*` and
`funnel_signup_start_locale_*` events (same non-joinable contract as the
MagicBrief blitz). Joining those starts to day-7 watchlist retention needs a
stored allowlisted `signup_source` on the user row. That is a later phase,
not this PR.

## Design record (design-it-twice)

- **Shipped:** locale prefix plus a shared slug (`/de/sneaker-resale`). One
  hreflang cluster, one new locale is one path.
- **Rejected:** keyword-native slugs per language (`/sneaker-reseller-beobachtung`).
  Harder to keep reciprocal hreflang honest, and Google does not use the URL
  language to pick a locale.
- **Grafted from the loser:** each page still uses native H1 and title
  keywords; only the slug stays shared.
