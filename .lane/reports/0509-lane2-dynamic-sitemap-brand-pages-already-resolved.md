# Dynamic sitemap entries for indexable /ads/:domain brand pages — already resolved

**Status: already resolved; this lane records the evidence only.**

Branch: `lane2/dynamic-sitemap-brand-pages-already-resolved`
Base: `origin/main` at `7960292d` (#737)
PR: nish3451/0509#745

## Item

- [ ] Ship the documented dynamic sitemap entries for indexable
  `/ads/:domain` brand pages (scout 2026-08-09, risk: amber).

## Verdict

No code change was warranted. The item is already landed on `origin/main` as
**PR #669** — `40e718ce` "feat(seo): dynamic sitemap entries for indexable
/ads/:domain brand pages", merged 2026-08-13, an ancestor of the current
`main` HEAD (`7960292d`). The scout flagged the item on 2026-08-09; the
feature landed four days later, before this lane ran.

## What PR #669 shipped

- **`app/lib/sitemap.server.ts`** (new, 266 lines) — generates `/ads/:domain`
  entries at sitemap-render time from existing `discovery_cache_entry` rows,
  following the strategy documented above `SITEMAP_XML` in
  `app/lib/seo.ts`:
  1. Only rows that WOULD RENDER the indexable brand-page state qualify:
     `public_search` route context (scheduled scan/warmup entries are shallow
     and never back a public page), non-demo provider AND payload (sample
     data is never presented as a brand's real ads on a public page), ads
     present in the payload (a zero-row would render the honest
     "haven't checked recently" shell, which self-noindexes), and
     `fetched_at` within the 7-day freshness window
     (`BRAND_PAGE_FRESH_FOR_INDEXING_MS`) — older captures render with an
     honest freshness line but must not rank.
  2. Domain recovery is strictly lossless-only (`brandDomainFromSitemapCacheRow`):
     a row maps to a brand page ONLY when its cache key or payload carries
     the registrable domain (search-v2 domain keys embed it; v2 payloads
     carry `searchIntent` + `displayDomain`). Legacy fingerprint keys are
     un-mappable and skipped — never guessed.
  3. The emergency brake `PUBLIC_BRAND_PAGES_INDEXABLE="0"` (noindex on every
     `/ads/*` page) suppresses dynamic entries entirely, and demo provider
     environments (no real cache to render) are skipped too, so the sitemap
     can never list a page that serves noindex.
  4. This is a bounded cache read only (`SITEMAP_BRAND_PATH_LIMIT = 500` —
     deliberate crawl-budget ceiling) — sitemap generation never triggers
     live discovery, Browser Rendering, or any paid operation. Any hiccup
     (missing `discovery_cache_entry` table on a fresh D1, unparseable rows)
     degrades to the static sitemap, never a 500.
- **`app/lib/seo.ts`** — shared `renderSitemapXml` builder so the static
  fallback (`SITEMAP_XML`, used when there is no D1 / no dynamic data) and
  the production sitemap can never drift. `/ads/*` is deliberately NOT in
  `SITEMAP_PATHS` — the set is dynamic.
- **`workers/app.ts`** — `/sitemap.xml` is served dynamically via
  `publicSitemapFile(env)` (GET/HEAD), which appends the indexable brand-page
  entries to the static funnel paths. robots.txt (`seo.ts` `ROBOTS_TXT`) has
  no `Disallow` covering `/ads/` and points crawlers at the dynamic
  `/sitemap.xml` via `Sitemap:`.
- **`app/routes/ads.$domain.tsx`** — comment updated to reference the
  sitemap strategy; the route itself already carried the indexability rules
  (indexable by default under `PUBLIC_BRAND_PAGES_INDEXABLE` unset/"1";
  honest-shell, demo-sourced, and stale >7-day states always self-noindex;
  canonical tag + WebPage JSON-LD only on indexable pages).
- **`tests/sitemap.server.test.ts`** (new, 313 lines) — unit coverage for
  domain recovery (exact vs broader scope, payload fallback, unparseable
  payloads), the indexability mirror (route context, demo source, empty ads,
  7-day freshness boundary), dedupe/order/bounds, and the D1 read path
  (no-DB, demo provider, emergency brake, missing table, genuine failures).

## Regression pins (all passing)

- `tests/sitemap.server.test.ts`:
  - "recovers the domain from an exact-scope search-v2 cache key",
    "skips broader-scope rows — the brand page would render the noindex
    shell", "recovers the domain from a legacy-shaped key when the payload
    is a v2 domain result", "does not map text-intent or plain legacy
    payloads to a brand page".
  - "rejects non-public_search route contexts", "rejects demo providers and
    demo payloads", "rejects rows with no usable (non-demo) ads", "rejects
    entries outside the 7-day indexability freshness window", "accepts a
    capture exactly at the 7-day boundary".
  - "dedupes domains across countries/cursors and keeps newest-first order",
    "bounds the sitemap to SITEMAP_BRAND_PATH_LIMIT entries",
    "keeps the static funnel paths first, then appends dynamic brand pages".
  - "returns the static-only set when D1 is absent", "returns the static-only
    set in demo-provider environments", "returns the static-only set under
    the PUBLIC_BRAND_PAGES_INDEXABLE emergency brake", "degrades to the
    static-only set when the discovery cache table is missing", "propagates
    genuine D1 failures instead of silently hiding them".
- `tests/seo.test.ts` — pins the sitemap/robots surface (`publicSeoFileForPathname`,
  `SITEMAP_PATHS`).

## Verification run (this lane)

Run on current main in this worktree (no product changes; evidence branch only):

```
$ npx vitest run --configLoader runner tests/sitemap.server.test.ts tests/seo.test.ts
 Test Files  2 passed (2)
      Tests  29 passed (29)
```

## Files

- `.lane/reports/0509-lane2-dynamic-sitemap-brand-pages-already-resolved.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
