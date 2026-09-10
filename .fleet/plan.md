# Plan — seo: add indexable /brands/<category> landing pages (issue #2067)

## Goal
Ship 7 indexable `/brands/<category>` landing pages (one per curated category in
`BRAND_CATEGORIES`), each listing its brands with ad count + Ad Aggression Score,
with per-category SEO (title, meta description, ItemList JSON-LD, social card,
canonical, breadcrumb), dynamic sitemap entries, and hub<->category internal
linking — reusing the existing `/brands` hub's indexable brand source. Empty
curated categories are omitted from the sitemap and 404'd. No D1 migration, no
gate-owned path edits, no new data source.

The 7 curated slugs (must match the issue verify exactly):
`sport-footwear e-commerce beauty-personal-care optical-eyewear saas-software wearables-health wallet-accessories`

- [x] phase 1: category slugify + curated-slug registry + social-card kind ("brand") in the pure libs (`brand-categories.ts`, `seo.ts`, `social-cards.server.ts`), unit-tested for slug round-trips.
  - reviewer: no critical/warning findings; slugs derive the 7 verify slugs correctly, brand/More-brands -> null, card path matches parse. (commit 7762b4c6)
- [x] phase 2+3: new `/brands/:category` route (`app/routes/brands.$category.tsx`) — loader reuses the hub's indexable brand source (`loadIndexableBrandPageEntries`) and 404s unknown / `more-brands` / empty curated categories; renders each brand with ad count + Ad Aggression Score; per-category title + category-intent meta description, ItemList JSON-LD, BreadcrumbList (Home > Brands > Category), WebPage JSON-LD, canonical, og:image+twitter:card = per-category social card. Registered in `app/routes.ts`.
  - reviewer: reviewed against the real exports it imports (all exist); loader reduced to a single cache-only read; bounded score enrichment degrades to honest `null`, never 500. (commit accc1dc4)
- [x] phase 4: `/brands` hub links every NON-EMPTY curated category to its `/brands/<slug>` page (derived, never hard-coded) and each category page links back to the hub.
- [x] phase 5: `brandCategorySitemapEntries()` — one entry per non-empty curated category, `lastmod` = newest brand lastmod, threaded through `buildSitemapXml` (optional 3rd param, backward compatible) + `publicSitemapFile`.
- [x] phase 6: tests added (`brand-categories.slug`, `brands-category.loader`, `brands-category.render`, `brands-route.render`, `sitemap.server`, `social-cards`) — node project only, no typecheck / no `--project workers`.
  - reviewer: manager re-run on the final commit — 8 files / 178 tests green, then the full affected suite `--changed origin/main` 259 files / 3122 tests green.

## Phase records
- phase 1: reviewer clean (commit 7762b4c6).
- phases 2-3 / 4 / 5 / 6: single implementation commit `accc1dc4` on top of `a1ede9c3`; per-phase reviewer note above. No phase stalled; no phase needed a retry round.
- Amendments: none. All 6 phases shipped as planned; no phase was dropped or added.

## Files to Modify
- `app/lib/brand-categories.ts` — add slug->label helpers + curated slug list, reusing the registry (no new classification source).
- `app/lib/seo.ts` — add `brandCategorySocialCardUrl(slug)` (mirror `clusterSocialCardUrl`).
- `app/lib/social-cards.server.ts` — add `"brand"` `SocialCardKind`, parse `/social-card/brand/<slug>.svg`, render the category label card.
- `app/lib/sitemap.server.ts` — add `brandCategorySitemapEntries(brandEntries)`, thread `categoryEntries` through `buildSitemapXml` + `publicSitemapFile`.
- `app/routes/brands.tsx` — expose non-empty curated category links; render "Browse by category" links.

## New Files
- `app/routes/brands.$category.tsx` — the per-category landing page (loader + meta + render).
- `tests/brands-category.render.test.tsx` — route render tests.
- `tests/brand-categories.slug.test.ts` — slug round-trip tests.

## Risks
- Slug/registry drift — the 7 verified slugs must match exactly; derived from the registry label, gated by a slug test.
- Sitemap/route parity — both computed from the same indexable brand source; both drop empty categories.
- Per-brand score enrichment — bounded (≤5 brands/category), must degrade to honest deferred `null`, never a 500.
- `links()` can't see params — canonical ships as a meta-descriptor `link` in `meta` (mirror `/ads`).
- No migrations, no typecheck, no `--project workers`.
## Reviewer round (manager, step 8)
- seat: `cursor/cursor-grok-4.6-high` (first usable entry of `senior_seats_in_order`; `bin/fleet-review-arm-check` exit 0). One round only.
- verdict: NOTHING BLOCKING. All 6 acceptance bullets confirmed against the real code; route registration confirmed (`app/routes.ts:87`); per-category social card confirmed live (not a dead og:image); loader confirmed 404-not-500 on a cache hiccup; no collision with `/brands` or `/ads/:domain`.
- Act on: none (no blocking finding).
- Consider: (a) visible breadcrumb missing, JSON-LD only (`brands.$category.tsx:247-257`); (b) no test for `loadIndexableBrandPageEntries` throw -> 404 not 500. Both queued as follow-up issues, not re-delegated.
- Noted: membership predicate vs `groupBrandRecordsByCategory`; score-lookup cap 5; `visitorCountry: "all"` only; dead empty-list UI; SVG og:image preview limits (tracked by #2089); hub `<h2>`s not links.
- Dismissed-with-reason: `tests/routes-manifest.test.ts` only mounts `api.*` — a canary gap outside this issue's scope.
- Manager run proof: 8 files / 178 tests green, then `--changed origin/main` 259 files / 3122 tests green.
