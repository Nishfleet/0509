# Dynamic sitemap entries for indexable `/ads/:domain` brand pages — already resolved (lane 3 re-run)

**Status: already resolved on `origin/main`; this lane records the evidence
only — no code change warranted, no duplicate PR opened.**

Branch: `lane3/dynamic-sitemap-brand-pages-already-resolved`
Base: `origin/main` at `422fbd55` (#806 tip at this run)
PR: (none — see "Why no PR" below)
Lane record: `/home/nish/workspaces/agent-state/lanes/0509/lane-3.json`
  (`item_id: bcfccb4689`, `product: 0509`)

## Item

- [ ] Ship the documented dynamic sitemap entries for indexable
  `/ads/:domain` brand pages [scout 2026-08-09, risk: amber].

## Verdict

No code change is warranted. The item is already landed on `origin/main` as
**PR #669** — `40e718ce` "feat(seo): dynamic sitemap entries for indexable
/ads/:domain brand pages", merged 2026-08-13, an ancestor of the current
`origin/main` HEAD (`422fbd55` at this run, ~9 ancestor merges further along
via #674, #737, #806, etc.). The scout flagged the item on 2026-08-09; the
feature landed four days later, before this lane ran. Lane 2's
re-verification record (`.lane/reports/0509-lane2-dynamic-sitemap-brand-pages-already-resolved.md`,
PR #745) was a sibling resolve on the same item from a prior run; this lane 3
record is the freshest re-verification.

## What PR #669 shipped (and still holds on origin/main)

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
  `SITEMAP_PATHS` — the set is dynamic. The comment block above
  `SITEMAP_XML` documents the strategy in one place (no drift between
  static-fallback and dynamic sitemap).
- **`workers/app.ts`** — `/sitemap.xml` is served dynamically via
  `publicSitemapFile(env)` (GET/HEAD), which appends the indexable
  brand-page entries to the static funnel paths. `robots.txt` (`seo.ts`
  `ROBOTS_TXT`) has no `Disallow` covering `/ads/` and points crawlers at
  the dynamic `/sitemap.xml` via `Sitemap:`.
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

## Confirmation on the current main tip

Direct `git log` confirms the feature is on the public history:

```
$ git log --oneline origin/main -- app/lib/sitemap.server.ts
40e718ce feat(seo): dynamic sitemap entries for indexable /ads/:domain brand pages (#669)

$ git log --oneline -- app/lib/seo.ts | head -5
db136437 feat(seo): publish proof-backed /competitor-monitoring category page
fbe22514 fix(seo): sync llms.txt deny list with robots.txt via shared constant (#674)
40e718ce feat(seo): dynamic sitemap entries for indexable /ads/:domain brand pages (#669)
c997407c feat(seo): decide and align AI crawler policy across robots.txt and llms.txt (#613)
25392ca2 feat(seo): truthful WebPage JSON-LD on indexable /ads/:domain brand pages (#549)
```

The strategy comment above `SITEMAP_XML` (no `/ads/*` in the static list;
dynamic entries appended at sitemap-render time only for indexable
public_search rows with non-demo payloads in the 7-day freshness window;
emergency brake suppresses dynamic entries; missing discovery_cache_entry
degrades to the static sitemap, never 500) is intact on the current
`origin/main` HEAD.

## Regression pins (all passing on this run)

Run from this worktree, fresh origin/main tip, no product changes:

```
$ node_modules/.bin/vitest run --configLoader runner \
    tests/sitemap.server.test.ts tests/seo.test.ts \
    tests/ads-brand-page.route.test.ts tests/ads-brand-page.render.test.tsx \
    tests/ads-brand-page.signals.test.ts tests/customer-claim-surface-registry.test.ts \
    tests/presence-robots.test.ts

 Test Files  7 passed (7)
      Tests  116 passed (116)
   Duration  2.73s
```

Targeted pins:

- `tests/sitemap.server.test.ts` — domain recovery
  ("recovers the domain from an exact-scope search-v2 cache key", "skips
  broader-scope rows — the brand page would render the noindex shell",
  "recovers the domain from a legacy-shaped key when the payload is a v2
  domain result", "does not map text-intent or plain legacy payloads to a
  brand page"), indexability mirror ("rejects non-public_search route
  contexts", "rejects demo providers and demo payloads", "rejects rows with
  no usable (non-demo) ads", "rejects entries outside the 7-day
  indexability freshness window", "accepts a capture exactly at the 7-day
  boundary"), assembly ("dedupes domains across countries/cursors and keeps
  newest-first order", "bounds the sitemap to SITEMAP_BRAND_PATH_LIMIT
  entries", "keeps the static funnel paths first, then appends dynamic
  brand pages"), and the D1 read path ("returns the static-only set when D1
  is absent", "returns the static-only set in demo-provider environments",
  "returns the static-only set under the PUBLIC_BRAND_PAGES_INDEXABLE
  emergency brake", "degrades to the static-only set when the discovery
  cache table is missing", "propagates genuine D1 failures instead of
  silently hiding them").
- `tests/seo.test.ts` — pins the sitemap/robots surface
  (`publicSeoFileForPathname`, `SITEMAP_PATHS`).
- `tests/ads-brand-page.*` — pins the route's indexability rules that the
  sitemap mirrors (noindex truth on cache-miss/demo/stale states).
- `tests/customer-claim-surface-registry.test.ts` — pins the registry entry
  that records the `metadata, robots, sitemap and security headers`
  surface (`expiry: route, metadata, host, robots, sitemap or header
  change`); current assessment is `assessed_pending_reproof` because
  proof pre-dates the merged surfaces, not because the surfaces are
  missing.
- `tests/presence-robots.test.ts` — pins the robots.txt surface that
  exposes the dynamic `/sitemap.xml` via `Sitemap:`.

## Why no PR

The packet instructs "push a branch and open a PR, or report plainly why
the item cannot be done." Opening a duplicate no-op PR would create a
second `0509-laneN-dynamic-sitemap-brand-pages-already-resolved` PR that
no orchestrator can merge and that conflicts with the existing resolve
record on the same item. Lane 2 already produced `.lane/reports/0509-lane2-dynamic-sitemap-brand-pages-already-resolved.md`
and PR #745 on this exact item; lane 3's contribution is the freshest
re-verification on the current main tip, recorded in the lane-unique
report below. The branch is created and pushed so the evidence is
visible without a second PR.

```
$ git -C .../0509-lane3-20260821-053035 checkout -b \
    lane3/dynamic-sitemap-brand-pages-already-resolved origin/main
Switched to a new branch 'lane3/dynamic-sitemap-brand-pages-already-resolved'
branch 'lane3/dynamic-sitemap-brand-pages-already-resolved' \
    set up to track 'origin/main'.
```

## Files

- `.lane/reports/0509-lane3-dynamic-sitemap-brand-pages-already-resolved.md` —
  this evidence record (the only file touched by this lane).
- `/home/nish/workspaces/agent-state/lanes/0509/lane-3.json` — claims
  list updated to the single lane-unique report path, via temp file +
  rename per the packet; `.bak-lane3-evidence-<YYYYMMDD>` left beside it
  per the in-place-edit convention.

No product code, route, sitemap module, seo module, tests, workers entry,
migrations, R2, Dodo checkout, auth flow, or pricing copy was changed.

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
The feature itself rolls back via `git revert 40e718ce` (or any descendant
that touched `app/lib/sitemap.server.ts` / `app/lib/seo.ts`).
