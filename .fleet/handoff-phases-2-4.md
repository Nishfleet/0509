# Handoff: implement issue #2067 phases 2-4 (worker)

Worktree `/home/nish/workspaces/agent-worktrees/issue-0509-2067` (branch `claim/issue-2067`), NOT the deploy clone.

Goal: Nishfleet/0509#2067 — indexable /brands/:category landing pages. Context: the /brands hub
(`app/routes/brands.tsx`) groups 52 tracked /ads/:domain brand pages into 7 curated buyer categories
via `groupBrandRecordsByCategory` but renders them inline on ONE route. We need dedicated, indexable,
per-category routes with their own SEO head, an ItemList schema, a sitemap entry, a social card, and
hub cross-links.

## Phase 1 is ALREADY DONE (banked in HEAD, do not redo):
- `app/lib/brand-categories.ts` has new pure helpers: `categorySlugForLabel(label)`,
  `categoryLabelForSlug(slug)` (returns null for unknown/"More brands"), `curatedCategorySlugs()`.
  7 curated slugs: sport-footwear, e-commerce, beauty-personal-care, optical-eyewear, saas-software,
  wearables-health, wallet-accessories. `groupBrandRecordsByCategory` already exists.
- `app/lib/seo.ts` has a new `itemListJsonLd({name, pathname, items})` builder (schema.org ItemList).
- Tests `tests/brand-categories.test.ts`, `tests/seo-itemlist.test.ts` exist.

## Implement phase 2 — the `/brands/:category` route + loader
Create `app/routes/brands.$category.tsx` (matches `/brands/:category`).
- Loader (server): `loadIndexableBrandPageEntries(env)` (from `~/lib/sitemap.server`) returns `SitemapEntry[]` with `.path` (the `/ads/:domain`
  path), `.adCount`, `.fetchedAt`, and (after the Phase 2 amendment below) `.score`. Build brand items:
  derive `domain = entry.path.slice("/ads/".length)`, `name = displayNameFromDomain(domain)` (from
  `~/lib/ads-internal-links`), keep `adCount` and `score`. Group with `groupBrandRecordsByCategory`.
  Resolve the category from the `:category` param via `categoryLabelForSlug`. If the slug is unknown
  (null label) OR the resolved category's group is empty → throw a 404 (mirror the /ads empty-guard
  spirit: issue says "if a curated category is empty, omit it from the sitemap and 404 it"). Return
  `{ category: label, items }`.
- Factor a pure helper to map SitemapEntry[] → the per-brand item list so it is unit-testable.
- Mirror the hub's resilience: an index-specialty/loader failure degrades gracefully (catch → empty).

## Phase 2 amendment (score plumbing)
In `app/lib/sitemap.server.ts`:
- Add optional `score: number | null` to `SitemapEntry` (`app/lib/seo.ts` interface, ~line 856).
- In `indexableBrandPageEntriesFromRows`, after `const payload = parseSitemapCachePayload(...)` and
  `nonDemoAdsFromPayload(payload)` (already computed), compute the aggression score with
  `computeBrandPageAggressionScore(ads, now)` (imported from `app/lib/brand-page.server`) and store it as
  `score` on the entry (number or null). The page's loader already uses this exact function, so the
  category page score matches the /ads/:domain page score.
- Update `tests/sitemap.server.test.ts` if it asserts the exact SitemapEntry shape is preserved.

## Implement phase 3 (category-page SEO head)
On `app/routes/brands.$category.tsx`:
- `<title>` + meta description targeting the category-intent query, e.g.
  "Sport & footwear competitor Meta ads | Five to Nine" and
  "Beauty & personal care competitor ad monitoring | Five to Nine". Parametrise from the category label.
- Per-category social card: `og:image` + `twitter:card=summary_large_image`, mirroring the /ads and
  /switch card patterns. Add a `brands` kind to `SocialCardKind` in
  `app/lib/social-cards.server.ts`, extend `parseSocialCardPathname` to recognise
  `/social-card/brands/<slug>.svg`, and render a category card in `renderSocialCard`. Add a
  `brandsCategorySocialCardUrl(categorySlug)` builder in `app/lib/seo.ts` next to
  `clusterSocialCardUrl`. The route stamps `og:image` = that URL.
- canonical tag: `canonicalLinks(pathname)` via the `links` LinksFunction, pathname `/brands/<slug>`.
- JSON-LD: `itemListJsonLd({ name, pathname: "/brands/<slug>", items: [{name, url: canonicalUrl(`/ads/<domain>`)} ...] })`
  and a `breadcrumbJsonLd` Home > Brands > <Category> and a `webPageJsonLd`. Reuse the seo.ts builders.
- `<MarketingNav>` + `<MarketingFooter>`, an `<h1>` with the category and an `<ul>` of brand `<Link>`
  to `/ads/<domain>` showing the brand name, the ad count, and the Ad Aggression Score (or an honest
  "pending" line when `score` is null), plus a back-link to `/brands`.

## Phase 4 — sitemap + hub cross-links
- In `app/lib/sitemap.server.ts` add a PURE helper
  `categoryEntriesFromBrandEntries(brandEntries: readonly SitemapEntry[]): SitemapEntry[]`:
  one entry per NON-EMPTY curated category — read the curated slugs via `curatedCategorySlugs()`
  + map back to labels; a category whose brand set is empty is OMITTED (never sitemap/hat a zero-page);
  `lastmod` = max `lastmod` (ISO date) among the brands in that category; `changefreq: "weekly"`;
  `priority: "0.6"`; path `/brands/<slug>`. OTHER/"More brands" never listed.
  Append these entries in `buildSitemapXml` AFTER `brandEntries` and BEFORE `timelineEntries`
  (or after timeline — your call, keep test expectations clear). Ensure `publicSitemapFile` passes them.
- `app/routes/brands.tsx`: each curated `<section>` `heading` links to `/brands/<slug>` (so the hub
  internally connects to each category page), and each category page links back to `/brands`. Depth:
  keep the hub mostly as-is and add the per-group category link.
- Verify the root sitemap then contains `/brands/<slug>` for each category with ≥1 brand and the
  hub renders those links.

## Acceptance (verify each)
1. For each of the 7 slugs the route returns 200 and carries an `ItemList` and `/ads/` links.
2. Category pages are in sitemap.xml (`/brands/` count ≥ 8 with the flat hub).
3. /brands hub links to each category page.
4. `npm test run --run` on `tests/brands-route.render.test.tsx`, `tests/sitemap.server.test.ts`,
   `tests/social-cards.test.ts`. Extend these tests for the new route/helpers, do not break them.
5. `npm run typecheck` clean. Use `npx vitest run tests/...` to iterate.

## Constraint rules (hard)
- TypeScript only; keep it small, no new dependencies, no new bin/ tools, no D1 migration (read-only
  over existing brand records). No agent attribution trailers in commits. Work only in this worktree.
- The route is EN-only (no /<locale>/ variant needed) like `/brands`.
- Files most relevant to read first: `app/routes/brands.tsx`, `app/routes/ads.$domain.tsx` (social
  card + meta + empty-guard), `app/routes/$locale.sneaker-resale.tsx` (category-ish page), `app/lib/seo.ts`
  (feeders/card/toJSON-LD + sitemap), `app/lib/social-cards.server.ts`, `app/lib/sitemap.server.ts`,
  `app/lib/brand-categories.ts`, `app/lib/ads-internal-links.ts`, `app/lib/brand-page.server.ts`
  (`computeBrandPageAggressionScore`).

Report: files changed (paths), key functions added, tests added/updated, any test output.