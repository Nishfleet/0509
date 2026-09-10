# Plan — issue #2067: /brands/<category> landing pages

Manager mode (difficulty: heavy). Phased checklist, one line per acceptance bullet.

## Acceptance (from issue body + judge decisions)

- One route per curated category in BRAND_CATEGORIES (>= 7), 200 with own title/meta.
- Each category page: ItemList schema listing that category's brands.
- Each category page: per-category social card (og:image + twitter:card).
- Each category page: canonical tag + breadcrumb (Home > Brands > Category).
- Every category page in sitemap.xml with lastmod.
- /brands hub links to each category page (and vice versa).
- Reuse groupBrandRecordsByCategory + brand-categories.ts — no new classification source.
- No D1 migration, no gate-owned path edits, no new data source.
- Empty category: omit from sitemap, 404 it (mirror /ads empty-guard).
- No unsourced search-volume or demand claims in copy/meta/PR (usage-uncited).

## Phases

- [ ] phase 1: Add category slug registry + slug<->label helpers in app/lib/brand-categories.ts (CURATED_CATEGORY_SLUGS, categorySlugForLabel, categoryLabelForSlug, BRAND_CATEGORY_SLUGS ordered list)
- [ ] phase 2: Create app/routes/brands.$categorySlug.tsx — loader reuses loadIndexableAdsInternalLinks + groupBrandRecordsByCategory, filters to one category, 404 on unknown slug or empty category; meta with per-category title/description; ItemList JSON-LD; breadcrumb (Home > Brands > Category); per-category social card via clusterSocialCardUrl or a new brands-category card; canonical tag
- [ ] phase 3: Update app/routes/brands.tsx hub to link each category h2 to its /brands/<slug> route; category route links back to /brands hub
- [ ] phase 4: Add the 7 curated /brands/<slug> paths to SITEMAP_PATHS + STATIC_CHANGEFREQ_PRIORITY in app/lib/seo.ts; update tests/customer-claim-surface-registry.test.ts sitemapPaths array
- [ ] phase 5: Add tests — brands-category render (ItemList, breadcrumb, links to /ads, empty-guard 404), category slug mapping round-trip, sitemap includes category paths, hub links to category pages
- [ ] phase 6: Run npm run typecheck + npm test to green, commit, push, open PR with Verification + run-proof

## Notes

- The 7 curated categories (alphabetical, matching groupBrandRecordsByCategory order):
  Beauty & personal care, E-commerce, Optical & eyewear, SaaS & software,
  Sport & footwear, Wallet & accessories, Wearables & health.
  "More brands" (BRAND_CATEGORY_OTHER) stays on /brands only (worker's call per issue).
- Slugs: beauty-personal-care, e-commerce, optical-eyewear, saas-software,
  sport-footwear, wallet-accessories, wearables-health (matching the issue's verify block).
- Social card: reuse clusterSocialCardUrl pattern. The issue says "per-category social card
  mirroring the /ads and /switch per-page card pattern". Simplest: use the generic
  clusterSocialCardUrl("competitor-monitoring") or site og-image. A dedicated per-category
  SVG card would need a new renderer — out of scope for structural SEO. Use the site-wide
  og-image.png (SOCIAL_IMAGE_URL) as the honest fallback; do NOT invent a card path that
  has no renderer. The meta still carries og:image + twitter:card=summary_large_image.
- No unsourced claims: titles/description state only what the page shows (category name +
  "competitor Meta ads" + "Five to Nine"). No search-volume numbers.
