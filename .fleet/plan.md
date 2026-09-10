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
- Each brand row shows the brand's ad count and Ad Aggression Score.

## Phases

- [x] phase 1: category slug registry + slug<->label helpers in app/lib/brand-categories.ts (CURATED_CATEGORY_LABELS/SLUGS, categorySlugForLabel, categoryLabelForSlug). Inherited from the previous run; verified by reading + `npm run typecheck` clean.
- [x] phase 2: app/routes/brands.$categorySlug.tsx — loader reuses the /brands hub read + groupBrandRecordsByCategory, filters to one category, 404 on unknown slug or empty category; per-category title/description, ItemList JSON-LD, Breadcrumbs, canonical, brandsSocialCardUrl. Inherited; render test passes.
- [x] phase 3: /brands hub h2 links each curated category to /brands/<slug>; category page links back to /brands. Inherited; render test passes.
- [x] phase 4: SITEMAP_PATHS + STATIC_CHANGEFREQ_PRIORITY entries and the dynamic category sitemap entries with lastmod. Inherited; SUPERSEDED by phase 7 (the static entries duplicate the dynamic ones).
- [x] phase 5: render + slug-mapping + sitemap + social-card + hub-link tests. Inherited; 82/83 pass, one meta-description assertion fails (fixed in phase 8).
- [ ] phase 6: show each brand's ad count and Ad Aggression Score on the category page, computed from the SAME brand-page row read the hub already does — no new data source, no extra D1 read, no new `bin/` file. Score renders only when `computeBrandPageAggressionScore` returns one; otherwise the honest "not enough history yet" state (never a fabricated number).
- [ ] phase 7: sitemap honesty + dedupe — drop the 7 static `/brands/<slug>` entries (they duplicate the dynamic entries, carry no lastmod, and would list an empty category that 404s). Dynamic `indexableBrandCategoryEntriesFromBrandEntries` entries (with lastmod) are the ONLY listing. Remove the 7 now-dead `LLMS_PAGE_DETAILS` blocks in app/lib/public-markdown.ts and the tests/customer-claim-surface-registry.test.ts additions.
- [ ] phase 8: fix the meta-description assertion (description must name the category label as written, e.g. "Sport & footwear", not the lowercased form); `npm run typecheck` + affected tests green; commit, push, open PR with Verification + run-proof.

## Amendment log

- phase 4 → 7 (2026-09-10, manager): the static SITEMAP_PATHS entries were added in the same PR as the dynamic category entries. Both would emit `<loc>https://0509.io/brands/<slug></loc>`, so the sitemap would carry each category URL twice — once without lastmod (static) and once with (dynamic) — and an empty curated category would be listed while its page 404s. The acceptance asks for lastmod and the empty-guard; the dynamic entries satisfy both, so the static ones go. Deletion-first.
- phase 6 added (2026-09-10, manager): acceptance says each brand links with its ad count and Ad Aggression Score; the inherited route renders name + domain + timeline link only.

## Notes

- The 7 curated categories (alphabetical, matching groupBrandRecordsByCategory order):
  Beauty & personal care, E-commerce, Optical & eyewear, SaaS & software,
  Sport & footwear, Wallet & accessories, Wearables & health.
  "More brands" (BRAND_CATEGORY_OTHER) stays on /brands only (issue's explicit worker's call).
- Slugs: beauty-personal-care, e-commerce, optical-eyewear, saas-software,
  sport-footwear, wallet-accessories, wearables-health (matching the issue's verify block).
- Social card: `brandsSocialCardUrl` renders a real per-category SVG through the existing
  social-cards.server.ts renderer (validated against the curated registry); no new renderer.
- No unsourced claims: titles/description state only what the page shows (category name +
  "competitor Meta ads" + "Five to Nine"). No search-volume numbers (issue label usage-uncited).
