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
- [ ] phase 2: new `/brands/:category` route (`brands.$category.tsx`) — loader reuses the hub's indexable brand source; 404 for unknown / empty category; renders brand list with ad count + Ad Aggression Score.
- [ ] phase 3: category page SEO — per-category title + category-intent meta description, ItemList JSON-LD, canonical tag, breadcrumb (Home > Brands > Category), og:image+twitter:card = per-category social card.
- [ ] phase 4: `/brands` hub links to each non-empty category page (and category links back to the hub) so the cluster is internally connected.
- [ ] phase 5: dynamic sitemap entries for non-empty curated categories (with lastmod), appended via `buildSitemapXml`; empty/"More brands" never emitted.
- [ ] phase 6: tests (node project only — no typecheck, no `--project workers`) + targeted run to green, then repo checks.

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