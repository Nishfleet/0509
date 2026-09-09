# Issue 2067 — /brands/:category indexable category landing pages (manager mode, fleet-ops#3274)

Source: Nishfleet/0509#2067. Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-2067, branch claim/issue-2067.
Manager amendments (manager decides, implementer proposes):
- score computed in `indexableBrandPageEntriesFromRows` (pure lib aggression-score.ts is client-safe) stored as optional `SitemapEntry.score: number | null` — NOT `ads?: AdRecord[]` (dragging full payloads through a client-safe type is a bigger surface than a scalar; same single D1 read).
- "More brands" gets no page (registry OTHER bucket stays hub-only), per the issue's worker's-call allowance.

- [ ] phase 1: Registry + pure helpers — bidirectional slug/label helpers in `app/lib/brand-categories.ts` (curated set derived from `new Set(Object.values(BRAND_CATEGORIES))`, no parallel list; OTHER excluded) + `itemListJsonLd` builder in `app/lib/seo.ts`; tests.
- [ ] phase 2: /brands/:category route (app/routes/brands.$category.tsx) — loader reuses the hub's exact signal (loadIndexableAdsInternalLinks → loadIndexableBrandPageEntries), groups with groupBrandRecordsByCategory, links each /ads/:domain with ad count + Ad Aggression Score (null → honest pending line); unknown slug / empty group → 404 mirroring the /ads empty-guard; SitemapEntry gains `score` populated from the already-parsed payload rows.
- [ ] phase 3: Category-page SEO head — meta via publicSeoMeta (category-intent title/description, per-category social card og:image + twitter:card=summary_large_image), canonicalLinks, ItemList + breadcrumb (Home > Brands > <Category>) JSON-LD; `brands` social-card kind in app/lib/social-cards.server.ts + brandsCategorySocialCardUrl builder in seo.ts.
- [ ] phase 4: Sitemap + hub cross-links — pure categoryEntriesFromBrandEntries in app/lib/sitemap.server.ts (one entry per NON-EMPTY curated category, lastmod = max fetchedAt among its brands, changefreq weekly, priority 0.6, OTHER never listed), appended in publicSitemapFile; /brands hub links each curated group heading to /brands/<slug>; category page links back to /brands.
- [ ] phase 5: Tests + green — tests/brands-category-route.render.test.tsx (title/canonical/breadcrumb/ItemList/brand links/pending score), categoryEntriesFromBrandEntries coverage (lastmod, omit-empty, OTHER excluded); npm run typecheck + brand test files to green; sgscan clean.

Reviewer outputs per phase are appended below as run-proof.

## Stall log
(none yet)
