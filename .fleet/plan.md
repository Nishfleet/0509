# Plan — #2189 Google Ads Transparency Center source

Issue: Nishfleet/0509#2189. Replaces the google_ads stub adapter with a real
implementation. Dependency #2218 (sources seam) merged. Files owned (per issue
`files:` line + judge batch-2 edit):

- `app/lib/sources/google-ads.server.ts` (replace stub adapter)
- `app/lib/sources/google-ads/google-ads-transparency.server.ts` (fetch client)
- `app/lib/sources/google-ads/google-ads-snapshot.server.ts` (diff logic)
- `app/components/sources/google-ads.tsx` (replace stub Section)
- `tests/sources/google-ads-transparency.server.test.ts`
- `tests/sources/google-ads-snapshot.server.test.ts`
- `tests/fixtures/google-ads-transparency/**`

Judge batch-2 binding edits applied:
- requiresEnv = () => true, implemented: true (coverage -> "configured")
- diff() returns SourceChange[]; the seam emits (no direct alert call)
- Section renders inside its own component only; never edit competitor page route
- claim table row stays "not live - stub"; #2188 flips it (do not edit claim table)
- termination: `npx vitest run tests/sources/google-ads*.test.ts`

Necessary seam-test updates (judge-ordered flip breaks stub assertions; scoped
to google_ads only; sequential landing order prevents source-vs-source conflict):
- `tests/sources/registry.test.ts` — exclude google_ads from all-stubs assertions
- `tests/presence-source-coverage.test.ts` — exclude google_ads from five-new-sources coming_soon assertion

## Phases

- [ ] phase 1: fetchCreativesByDomain(domain,{maxCreatives:200}) — pages SearchCreatives (40/page, stop at maxCreatives or no token), 1 req/sec max, 20s timeout, one attempt per page; normalized creatives [{advertiserId,advertiserName,creativeId,format,domain,firstShownAt,lastShownAt,previewUrl|null}]; unavailable on non-200/parse-fail/HTML; format enum 1=text 2=image 3=video else unknown (documented from fixtures + GoogleAdsTransparencyScraper); previewUrl from 3.3.2 img html; truncated:true when maxCreatives hit.
- [ ] phase 2: diffSnapshots(prev,next) — new creative ids (ad_new); creatives whose lastShownAt stopped advancing 7+ days (ad_inactive, paused); new advertiser ids on domain (ad_new); format mix change (website_page_changed); no change -> []. Pure function over snapshot payloads.
- [ ] phase 3: adapter google-ads.server.ts — id google_ads, label "Google Ads (Transparency Center)", kind ads, implemented true, cadence daily, requiresEnv ()=>true; fetch looks up watchlist target_id via getWatchlist -> domainFromWatchlistTargetId -> fetchCreativesByDomain -> buildSnapshotPayload; diff -> diffSnapshots; Section = GoogleAdsSection.
- [ ] phase 4: GoogleAdsSection component — render advertiser name(s), total creatives, new since last check (from diff), format mix, up to 12 image previews (previewUrl, lazy-loaded, no video embeds). Null when no snapshot.
- [ ] phase 5: tests — transparency (3-domain field mapping, paging with token, maxCreatives stop, unavailable non-200/HTML/parse, zero ads, format mapping, pacing) + snapshot (new creative, paused 7+ days, new advertiser, format mix, no change); update registry + coverage seam tests for google_ads.
- [ ] phase 6: termination `npx vitest run --configLoader runner --project node tests/sources/google-ads*.test.ts tests/sources/registry.test.ts tests/presence-source-coverage.test.ts` green; commit; PR with Verification + run-proof; arm auto-merge.
