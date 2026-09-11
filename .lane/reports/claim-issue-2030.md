# Lane evidence — claim/issue-2030 (Nishfleet/0509#2030)

## Goal

Locale-prefixed buyer-surface pages (`/de/pricing`, `/ja/search`, …) already
served 200 with canonical→EN, but the EN canonicals emitted zero hreflang, so
Google treated the annotations as one-way and ignored them. The root sitemap
also carried no locale URLs.

## What changed

- `app/lib/seo.ts` — `buyerSurfaceHreflangLinks()` now emits the complete
  cluster (`en` + de/ja/pt-br/fr/es + `x-default`); the same call serves EN
  and locale pages. New `sitemapHreflangAlternates(path)` maps any EN or
  locale path to its cluster, and `renderSitemapXml` emits it as
  `<xhtml:link rel="alternate">` children under each `<url>` (xmlns:xhtml
  added). Locale URLs are never their own `<loc>` — issue #1561's rule holds.
- `app/lib/locale-markets.ts` — `BUYER_SURFACE_GUIDE_PATHS` single source for
  the two /guides/* paths; `sitemap.server.ts` consumes it.
- EN routes with locale twins now append `buyerSurfaceHreflangLinks(<splat>)`:
  marketing `/`, pricing, help, docs, api/docs, status, changelog, trust,
  compare, search, competitor-monitoring, capture-rules, methodology, the 10
  canonical compare children, the two guides, and both switch pages via
  `switchPageLinks`. Canonicalized-away losers (compare/visualping,
  visualping-ad-library, foreplay) emit no cluster, matching their locale
  twins' documented no-cluster rule.
- `app/routes/ads.$domain.tsx` — `meta()` emits the hreflang cluster as
  `tagName: "link"` descriptors (links() cannot see route params), gated on
  `!loaderData.noindex`. The locale twin re-exports the same meta, so both
  sides emit the identical set.
- `tests/seo/hreflang-reciprocal-cluster.test.ts` — new: EN route links,
  locale-twin parity, loser exclusion, /ads meta gating, sitemap alternates
  (root + locale feeds), no-`<loc>`-for-locales guard.
- Existing pins updated for the added `en` entry (locale-child-routes,
  locale-buyer-surface, locale-first-value-routes, pricing, search, guides,
  methodology, switch, new-compare, sitemap urlset xmlns, loc-scoped ads
  regex).

## Verification

- `npx vitest run --configLoader runner --project node --changed origin/main`
  — 358 files / 4361 tests pass.
- verify-0509 fixture server (`npm run e2e:serve:local`, 127.0.0.1:4179):
  - `/` → 7 `rel="alternate" hreflang` links (en, de, es, fr, ja, pt-br,
    x-default).
  - `/de/pricing` → identical complete cluster.
  - `/sitemap.xml` → 24+ `/de/|/ja/|/pt-br/` matches as xhtml:link alternates;
    no locale `<loc>`.
  - `/de/sitemap.xml` → per-entry cluster on every locale `<loc>`.
  - `/ads/nykaa.com` → 301 to `/search` (honest empty capture on plain dev
    server — correct; indexability gate unchanged).
- Production baseline before deploy: `curl -sS https://0509.io/ | grep -c
  'hreflang='` → 0; `curl -sS https://0509.io/sitemap.xml | grep -c
  '/de/\|/ja/\|/pt-br/'` → 0.
