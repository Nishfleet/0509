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
  the seven /guides/* paths; `sitemap.server.ts` consumes it.
- EN routes with locale twins now append `buyerSurfaceHreflangLinks(<splat>)`:
  marketing `/`, pricing, help, docs, api/docs, status, changelog, trust,
  compare, search, competitor-monitoring, capture-rules, methodology, the 13
  canonical compare children (bigspy, minea, poweradspy joined in the salvage
  pass), the seven BUYER_SURFACE_GUIDE_PATHS guide routes (two here; the five
  #2888/#3093/#3127 routes completed in the 2026-09-13 run below), and both
  switch pages via `switchPageLinks`. Canonicalized-away losers (compare/visualping,
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

## 2026-09-13T21:07Z run (pi-issue-0509-2030)

Salvage carried two deaths (`success/0`, 2026-09-13): the #2871 methodology
 deep-EN-canonical legs, the bigspy/minea/poweradspy EN compare routes, and
 the guides/switch-magicbrief pin alignments — all committed here as the two
 `wip(salvage)` commits.

This unit's delta:

- Found and fixed the five remaining one-way EN guides (their `$locale`
  twins emitted; the EN routes did not — exactly the issue's premise):
  `guides.how-to-get-alerted-when-a-competitor-changes-their-offer`,
  `guides.how-to-monitor-competitor-landing-page-changes`,
  `guides.how-to-prove-what-changed-on-a-competitor-website`,
  `guides.how-to-turn-a-one-off-competitor-check-into-a-standing-watch`,
  `guides.meta-ad-library-api-limitations` — the same three-line
  `buyerSurfaceHreflangLinks(PATHNAME.slice(1))` spread the two covered
  guides already used, plus the three `guides-routes.test.ts` pin
  alignments (the #3093 trio shares one loop) and a reciprocal-test case
  (representative: `guides.meta-ad-library-api-limitations`).
- 40/40 `$locale.*` twins verified reciprocal: the twins' existing `en` legs
  gained their EN answers; the three canonicalized-away compare losers
  correctly stay silent (pinned); `/ads/:domain` via the noindex-gated
  meta re-export; `/sneaker-resale`'s EN self rides `SNEAKER_RESALE_MARKETS`'s
  `en` row (pre-#2030, still symmetric).

Inner loop: 4724/4724 (round 1, salvaged state) → 4720/4725, 5
`guides-routes.test.ts` pins red (round 2, after the five-route fix) →
4725/4725 (round 3, green) + scoped `guides-routes.test.ts` 38/38.
`sgscan --base origin/main` → "No new security findings.", exit 0.
`crgate --base origin/main` → exit 0 (not-signed-in notice, informational).
Production baseline at claim: `/` → 0 hreflang, `/sitemap.xml` → 0 locale
URLs (pre-merge truth: `git merge-base --is-ancestor 8fab568f7 origin/main`
→ 1 — not production; the PR is the deploy).

Reviewer round: adjudication recorded in the PR body. Seat:
nebius/zai-org/GLM-5.3-Flash via `find_senior_seat` (senior ladder
exhausted, fallthrough); agent file `~/.pi/agent/agents/reviewer-2030.md`,
actions.log 20260913T210746Z.
