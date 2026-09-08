# Lane evidence: lane/pricing-page

## Item
Publish an indexable `/pricing` page (`36a150a360`).

## What shipped
- Extracted pricing block from `app/routes/marketing.tsx` into `app/components/pricing-section.tsx` (single source for home `#pricing` and `/pricing`).
- Added `app/lib/pricing-preview.server.ts` with bounded SSR preview helper (2500 ms, unchanged behavior).
- Added `app/routes/pricing.tsx` with canonical SEO, WebPage + billing FAQ JSON-LD, private cache when prices embed.
- Registered route in `app/routes.ts`; added `/pricing` to sitemap, LLMS page details, and `PUBLIC_CACHEABLE_HTML_PATHS`.
- Repointed global nav Pricing link to `/pricing` (home anchor and other `/#pricing` links unchanged).

## Verification
- `npm run typecheck` → exit 0
- Spec-required tests (12 files, 126 tests) → all pass
- `npm run build` → exit 0
- Greps: route registered, sitemap + changefreq, nav `to="/pricing"` only
- Local dev (`127.0.0.1:4179/pricing`): HTTP 200, canonical present, title `Pricing | Five to Nine`, billing FAQ rendered

## Note
Full `npm run test` reports 27 failures in `workspace-seats.test.ts` (and related) — pre-existing on `origin/main`, unrelated to this diff.

## Branch
`lane/pricing-page` @ `dd36fb5a`
