# Phase report — issue #2067 phases 2-6 (brand category landing pages)

worker: phases 2–6 of "add indexable /brands/<category> landing pages" on
branch `claim/issue-2067`. Phase 1 (slug registry + brand social-card kind,
HEAD `bbc69d56`) was already committed and was NOT re-done.

## What changed

### Phase 2-3 — `/brands/:category` route (new `app/routes/brands.$category.tsx`)
- Reviewed the untracked draft against the real exports it imports; all
  imports exist (`brandCategoryFromSlug`, `brandCategoryForDomain`,
  `indexableAdsLinkFromPath`, `loadIndexableBrandPageEntries`,
  `loadBrandPageCacheSnapshot`, `computeBrandPageAggressionScore`,
  `publicSeoMeta`, `itemListJsonLd`, `breadcrumbJsonLd`, `webPageJsonLd`,
  `brandCategorySocialCardUrl`, etc.).
- Optimized the loader to a SINGLE cache-only D1 read: links are derived from
  `loadIndexableBrandPageEntries` via `indexableAdsLinkFromPath` — the exact
  path the hub's `loadIndexableAdsInternalLinks` uses — instead of calling
  both (one would have silently re-read the same set). Same semantics, one
  fewer read.
- Loader 404s unknown slugs, the "More brands" fallback slug (`more-brands`),
  and empty curated categories (mirror #1988). Lists only the brands in the
  category; per-brand ad count comes from the sitemap entries, Ad Aggression
  Score is a bounded (≤5) cache-only enrichment that degrades to honest
  deferred `null` on any hiccup — never a 500.
- Per-category `<title>` + category-intent meta description, canonical
  descriptor link (links() can't see params, mirror /ads), og:image +
  twitter:card = `brandCategorySocialCardUrl(slug)`, ItemList JSON-LD,
  BreadcrumbList (Home > Brands > Category), WebPage JSON-LD (dateModified =
  newest brand lastmod). Links back to the `/brands` hub.
- Registered the route: `route("brands/:category", "routes/brands.$category.tsx")`
  in `app/routes.ts` (routes are explicit config; the file is NOT served
  without this — the routes-manifest class of bug).

### Phase 4 — hub → category links (`app/routes/brands.tsx`)
- Loader now derives `categoryLinks` from `CURATED_BRAND_CATEGORY_SLUGS` +
  `brandCategoryFromSlug` (never hard-coded), keeping only NON-EMPTY curated
  categories. Render adds a "Browse by category" row linking each to
  `/brands/<slug>`. Empty curated categories and "More brands" get no link.

### Phase 5 — sitemap (`app/lib/sitemap.server.ts`)
- New pure `brandCategorySitemapEntries(brandEntries)`: one entry per
  NON-EMPTY curated category, `lastmod` = newest brand lastmod in that
  category (no invented dates), priority 0.6 / changefreq weekly (mirrors the
  /brands hub static entry). Empty categories and "More brands" are never
  emitted.
- Threaded through `buildSitemapXml(brandEntries, timelineEntries,
  categoryEntries)` (3rd optional param, backward compatible) and
  `publicSitemapFile` (computes category entries from the brand entries).
  When all 7 curated categories are populated, `/brands*` sitemap count is
  7 + the static hub = >= 8.

### Phase 6 — tests (node project only; touched files)
- `tests/brands-category.render.test.tsx` (new): renders brand list with ad
  count + Ad Aggression Score, honest "pending" for deferred score, back link,
  ItemList + BreadcrumbList JSON-LD, WebPage dateModified, and `meta` title /
  description / canonical / og:image / twitter:card.
- `tests/brands-category.loader.test.ts` (new): loader 404 on unknown slug,
  "more-brands", empty curated category; lists exactly the category's brands;
  lastMod = newest; deferred-score degradation; bounded score reads.
- `tests/brands-route.render.test.tsx`: hub links each non-empty curated
  category, never "more-brands", omits the row when empty.
- `tests/sitemap.server.test.ts`: `brandCategorySitemapEntries` aggregation,
  empty/More-brands omission, lastmod-omission when undated, and the
  `buildSitemapXml` thread-through asserting all 7 slugs + hub (>= 8).

## Green test run (node project, VITEST_MAX_WORKERS=2)

```
$ npx vitest run --configLoader runner --project node \
    tests/brands-category.render.test.tsx tests/brands-category.loader.test.ts \
    tests/brands-route.render.test.tsx tests/sitemap.server.test.ts \
    tests/brand-categories.slug.test.ts tests/social-cards.test.ts
Test Files  6 passed (6)
      Tests  181 passed (181)

$ npx vitest run --configLoader runner --project node \
    tests/routes-manifest.test.ts tests/public-routes-no-sample-proof.test.ts
Test Files  2 passed (2)
      Tests  5 passed (5)
```

(186 tests green across the 8 files. No `--coverage`, no typecheck, no
`--project workers`.)

## Constraints honored
- No agent attribution / no Co-Authored-By / no "Generated with".
- No push to main; work on `claim/issue-2067` only.
- No typecheck, no `tsc -b`, no `--coverage`, no `--project workers`; one
  toolchain process at a time (`VITEST_MAX_WORKERS=2`).
- The 7 slugs are exactly those the issue verifies. No new migration.