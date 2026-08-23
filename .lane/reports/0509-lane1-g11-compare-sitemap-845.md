# 0509 lane 1 — G11 compare sitemap snapshot

Item `f4322abbf8`. Branch `0509-lane1-g11-compare-sitemap-845`.

## Goal

Register the four PR #845 compare routes (`/compare/visualping`, `/compare/spyland`, `/compare/pulzifi`, `/compare/foreplay`) in the G11 claim-surface sitemap snapshot so #845 can merge without catalog-drift.

## Not already on main

`origin/main` at `8824abc8` does not contain the four paths. PR #845 (`0509-lane3-compare-pages-rivals`) is still OPEN.

## Files changed

- `app/lib/seo.ts` — `SITEMAP_PATHS` and `STATIC_CHANGEFREQ_PRIORITY` (`weekly` / `0.7`, no `lastmod`)
- `app/lib/public-markdown.ts` — `LLMS_PAGE_DETAILS` titles/descriptions from the #845 route copy
- `tests/customer-claim-surface-registry.test.ts` — pinned `expectedCatalogs.sitemapPaths`
- `tests/seo.test.ts` — four sitemap `<loc>` assertions

## Proof

- `npm run typecheck` → exit 0
- `npx vitest run tests/seo.test.ts tests/customer-claim-surface-registry.test.ts tests/sitemap.server.test.ts tests/public-markdown.test.ts` → `Test Files  4 passed (4)` / `Tests  41 passed (41)`
