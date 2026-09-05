# Commercial Ad Ingestion Replacement Plan

> **For agentic workers:** REQUIRED: Use `superpowers:writing-plans` before expanding this plan and `superpowers:executing-plans` or `superpowers:subagent-driven-development` before implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `0509`'s dependency on the official Meta Ad Library API for India commercial-ad discovery while preserving the shipped proof-first monitoring pipeline, public search flow, and `watch_event`-centered product model.

**Architecture:** Keep the current React Router + Workers app, keep the proof-first scan -> proof -> event -> delivery loop, and swap only the upstream discovery layer. Introduce a provider resolver that can serve public search and watchlist scans from a browser-backed Ad Library capture path, with explicit cache, budget, and degradation rules. Treat the official Meta API as a narrow diagnostic adapter, not the default commercial-ad source.

**Tech Stack:** React Router v7 on Cloudflare Workers, Cloudflare Workflows, Cloudflare Browser Run, D1, optional R2, TypeScript, Vitest

---

## Why This Plan Exists

### Current Live Blocker

- On April 19, 2026, the production dogfood watchlists for `adspy`, `bigspy`, and `adflex` stopped on the official Meta API path with:
  - `error_code: 10`
  - `Application does not have permission for this action`
- The shipped request bug is already fixed and merged on `main`:
  - `cde734f` `fix: send ad reached countries to meta`
- This means the remaining failure is no longer request shape. It is provider viability.

### Official Provider Reality

- Meta's own Ad Library API page says the API is for:
  - ads about social issues, elections, or politics delivered anywhere in the world
  - ads of any type delivered to the European Union during the past year
- The same page explicitly says that searching all currently running ads should use the public Ad Library.
- Meta's public help docs also say the Ad Library and Page Transparency flows expose currently active ads publicly.

### Product Consequence

- `0509` cannot keep treating the official Meta API as the main discovery path for India commercial-ad monitoring.
- The right replacement is not a new product architecture.
- The right replacement is a new discovery provider under the existing proof-first product.

## Current Repo Baseline

- Public `/search` still imports `searchAds(...)` directly from `app/lib/meta-api.server.ts`.
- Monitoring still imports `searchAds(...)` directly from `app/lib/meta-api.server.ts`.
- `prepareSearchResultSelection(...)` in `app/lib/search-selection.server.ts` already does the useful downstream work after discovery:
  - persisted creative hydration
  - landing-page capture
  - creative text capture
  - translation
- The shipped proof-first system already exists and should remain the backbone:
  - `watch_event`
  - selective proof capture
  - proof-backed event confirmation
  - delivery policy
  - email + WhatsApp delivery
- Current status/copy still assumes:
  - missing token = demo mode
  - token present = live ready
- That assumption is now false in production.

## Core Doctrine

### Keep The Product, Swap The Source

- Do not rewrite the proof-first architecture.
- Do not create a second event model.
- Do not turn this into a generic scraping platform.
- Replace only the commercial-ad discovery layer and its status model.

### Public Search And Monitoring Must Share One Source Resolver

- Public search and watchlist scans must stop calling provider-specific code directly.
- Both should call the same source resolver with different execution policies:
  - public search: short-lived, cache-first, abuse-aware
  - watchlist scan: bounded, budgeted, workflow-safe

### No Silent Production Demo Fallback

- Production must never silently fall back from a live provider error to fake demo data.
- Demo data should remain available only for:
  - local development
  - explicitly flagged product demos
  - tests that intentionally exercise demo mode
- If live discovery fails in production, surface:
  - degraded provider status
  - cached results if available
  - honest empty state if not

### Keep Legacy `metaAdId` For The First Replacement Slice

- Do not rename `metaAdId` during the provider swap.
- Treat it as the stable ad-library identifier field for v1 of the replacement.
- A broad rename can happen later if it still matters after the provider abstraction is stable.

### Browser Time Is A Separate Budget From Proof Time

- Discovery scans will now spend browser time too.
- Keep discovery budgets separate from landing-page proof budgets.
- Do not let discovery quietly consume the same budget pool as confirmation proof.

## V1 Replacement Shape

### Provider Matrix

- `meta_library_browser`
  - default live provider for India commercial-ad discovery
  - used by public search and watchlist scans
  - backed by Browser Run
- `meta_api`
  - retained only for:
    - political/issue smoke tests
    - EU-delivered ad diagnostics
    - schema comparison during migration
  - not the default commercial-ad source
- `demo`
  - local or explicitly flagged only
  - not allowed as a silent production fallback

### Browser-Backed Discovery Model

- Use Browser Run to load public Meta Ad Library result pages for:
  - advertiser searches
  - keyword searches
- Extract only cheap discovery fields during scan:
  - ad/library id
  - advertiser/page label
  - body/title/description snippets if visible
  - snapshot URL
  - apparent landing-page URL if visible
  - first seen / last seen / active status if visible
  - publisher platforms if visible
- Do not do landing-page proof capture inside discovery scans.
- Do not expand discovery into full page-proof work.
- Preserve the current downstream `prepareSearchResultSelection(...)` and proof-policy flow.

### Public Search Shape

- Public search becomes cache-first and provider-aware.
- Anonymous public search must not launch an uncached browser session on every request forever.
- V1 rules:
  - cache by normalized query fingerprint + page cursor
  - serve fresh cached results when available
  - refresh in the background or on bounded live fetch when stale
  - keep live fetch page caps conservative

### Monitoring Shape

- Watchlist scans use the same provider resolver but with watchlist-safe budgets.
- Keep `performBoundedScan(...)` as the cheap-scan seam, but change what powers it.
- Preserve:
  - observation persistence
  - scan-native event drafts
  - proof targeting
  - `watch_event`
  - delivery

## Hard Rules

### Source Status Model

- Stop modeling discovery health as only `Meta token present` vs `demo mode`.
- Replace it with explicit provider health:
  - `healthy`
  - `degraded`
  - `cache_only`
  - `demo`
  - `disabled`
- Status summaries must name the real current mode:
  - `Live commercial discovery running through Browser Run`
  - `Commercial discovery degraded; serving cached results`
  - `Demo data only in explicit non-production mode`
  - `Official Meta API available only for diagnostic/EU/political use`

### Discovery Budget Defaults

- Discovery budgets are conservative in v1.
- Default ceilings:
  - public anonymous live fetches: `1` fresh provider fetch per query fingerprint per `15 minutes`
  - public live page cap: `1` page per fresh anonymous fetch
  - watchlist scan page cap: `2` result pages per run
  - watchlist daily discovery cap: `8` result pages
  - workspace daily discovery cap: `120` result pages
- Default retry policy:
  - browser launch / transient navigation failures: `1` retry
  - login wall / captcha / parser drift failures: `0` retries
- Default degradation rule:
  - if the last `20` discovery fetches for a provider fail at `>= 40%`, switch that provider to `cache_only` until manual recovery or the next cooling window

### Discovery Cache Rules

- Cache key must include:
  - provider
  - normalized query fingerprint
  - page cursor or page number
  - country
- Cache entry should store:
  - normalized ads payload
  - provider metadata
  - browser ms used
  - fetched at
  - expires at
- Default TTLs:
  - anonymous public search: `15 minutes`
  - signed-in public search: `10 minutes`
  - watchlist scans: no serving from stale cache older than `24 hours`

### Parser Safety

- The browser provider must classify failures separately:
  - browser launch failure
  - timeout
  - login wall
  - rate limit
  - markup drift / selector miss
  - empty result
- Persist the failure class for operator review.
- Do not collapse all provider failures into `Meta API failed`.

### Compliance Boundary

- This plan is only the technical replacement plan.
- Broad production use of browser-based public-ad capture should still get a legal/compliance review before scale.
- Do not encode a claim that compliance review is complete unless Nish explicitly says so.

## File Map

### Create

- `migrations/0008_commercial_ad_ingestion_replacement.sql`
- `app/lib/ad-source.server.ts`
- `app/lib/meta-library-browser.server.ts`
- `app/lib/discovery-cache.server.ts`
- `tests/ad-source.test.ts`
- `tests/meta-library-browser.test.ts`
- `tests/discovery-cache.test.ts`
- `tests/search-provider-route.test.ts`
- `tests/monitoring-provider.test.ts`
- `docs/superpowers/artifacts/2026-04-19-commercial-ad-dogfood-set.md`

### Modify

- `README.md`
- `app/lib/types.ts`
- `app/lib/meta-api.server.ts`
- `app/lib/data.server.ts`
- `app/lib/search-selection.server.ts`
- `app/lib/monitoring.server.ts`
- `app/routes/search.tsx`
- `app/routes/app.dashboard.tsx`
- `app/routes/app.watchlists.tsx`
- `app/routes/app.ops.tsx`
- `tests/plan-monitoring.test.ts`
- `tests/proof-first-pipeline.test.ts`

## Implementation Tasks

### Task 1: Freeze The Provider Truth And Remove The Wrong Product Assumption

- [ ] Update docs and status language so production no longer equates `token exists` with `live commercial search works`.
- [ ] Update `README.md` environment notes:
  - official Meta API is not the primary commercial-ad ingestion path for India
  - demo mode is explicit only
- [ ] Add a short source matrix artifact for operators and future contributors.
- [ ] Verify all user-facing and operator-facing copy that still says:
  - `Meta Ad Library secret detected and ready for live searches`
  - `explicit demo mode because no Meta token is configured`
- [ ] Expected: no shipped surface misstates the live provider truth.

### Task 2: Introduce The Source Resolver Without Changing Product Behavior Yet

- [ ] Create `app/lib/ad-source.server.ts` as the single entrypoint for discovery.
- [ ] Move provider-specific behavior behind a resolver contract:
  - `search`
  - `status`
  - `mode`
  - `provider`
  - `cache metadata`
- [ ] Keep the current `meta-api.server.ts` as one adapter under that resolver.
- [ ] Extend `AdRecord.source` and `SearchResponse.source` beyond `"meta" | "demo"` so the system can distinguish:
  - browser-backed live capture
  - API diagnostic mode
  - demo
  - cached live result
- [ ] Keep `metaAdId` stable for now.
- [ ] Expected: search and monitoring can switch providers without changing downstream proof/delivery logic.

### Task 3: Add Browser-Backed Public Ad Library Discovery

- [ ] Create `app/lib/meta-library-browser.server.ts`.
- [ ] Use Browser Run for rendered result-page capture.
- [ ] Default to the simplest reliable method first:
  - quick actions if enough
  - session-based Puppeteer only where the result-page workflow truly needs it
- [ ] Extract and normalize:
  - library id
  - advertiser/page label
  - visible creative fields
  - snapshot URL
  - delivery timing
  - active status
  - platform labels
- [ ] Persist provider metadata needed for debugging:
  - provider name
  - fetch method
  - browser ms used
  - result page URL
  - parser version
  - failure class when applicable
- [ ] Expected: browser-backed discovery can return normalized `AdRecord` results without touching landing-page proof.

### Task 4: Add Discovery Cache, Budgets, And Provider Health Logging

- [ ] Add migration `0008_commercial_ad_ingestion_replacement.sql`.
- [ ] Add tables for:
  - discovery fetch logs
  - discovery cache entries
  - provider health / degradation state
- [ ] Do not overload `meta_integration_log` with browser-provider semantics.
- [ ] Record:
  - provider
  - query fingerprint
  - route context (`public_search`, `watchlist_scan`)
  - status
  - browser ms used
  - cache hit / miss
  - failure class
  - fetched at / expires at
- [ ] Add cleanup or overwrite rules so cache rows stay bounded.
- [ ] Expected: provider state is observable and cache/budget behavior is explicit.

### Task 5: Rewire Public Search To The Resolver

- [ ] Replace direct `searchAds(...)` imports in `/search` with the source resolver.
- [ ] Keep `prepareSearchResultSelection(...)` unchanged where possible.
- [ ] Remove silent production fallback from live failure to demo data.
- [ ] Add source labels that match truth:
  - `Live Ad Library capture`
  - `Cached live results`
  - `API diagnostic`
  - `Demo dataset`
- [ ] Preserve current saved-query and watchlist-creation flows.
- [ ] Expected: public search stays usable without pretending demo data is live production data.

### Task 6: Rewire Monitoring To The Resolver

- [ ] Replace direct `searchAds(...)` imports in `app/lib/monitoring.server.ts` with the source resolver.
- [ ] Keep `performBoundedScan(...)` as the scan seam.
- [ ] Keep scan-native event logic, proof targeting, and delivery orchestration intact.
- [ ] Change monitoring/provider logs to report the real provider and degradation state.
- [ ] Preserve shared scan reuse across watchlists with the same fingerprint.
- [ ] Expected: watchlist runs can discover ads through the browser-backed provider without disturbing the proof-first event pipeline.

### Task 7: Update Operator And Trust Surfaces

- [ ] Update dashboard and ops surfaces to show:
  - current live discovery provider
  - last successful live discovery fetch
  - cache-only mode if active
  - recent failure classes
  - budget-paused state if discovery caps are reached
- [ ] Update watchlist and search UI copy so users understand whether results are:
  - live
  - cached
  - demo
- [ ] Add one operator view that answers:
  - what is failing
  - what is serving from cache
  - what is paused by discovery budget
  - which watchlists are source-degraded right now
- [ ] Expected: operator state is explicit instead of hidden behind generic Meta messages.

### Task 8: Dogfood And Launch-Gate The Replacement

- [ ] Create the dogfood set artifact with the seeded brands:
  - `adspy`
  - `bigspy`
  - `adflex`
- [ ] Verify public search on all three.
- [ ] Verify watchlist scans on all three.
- [ ] Verify proof-first downstream still works once discovery is live:
  - observation persistence
  - candidate generation
  - proof targeting
  - `watch_event`
  - delivery
- [ ] Launch gate before trusting the replacement more broadly:
  - discovery fetch success rate on dogfood set: `>= 90%`
  - normalized field completeness for `library id`, `advertiser`, and `snapshot URL`: `>= 90%`
  - seeded watchlists complete `3` consecutive successful daily runs
  - production sends `0` demo-backed customer alerts
  - provider failure classes are visible in the operator surface
- [ ] Expected: the replacement is operationally trustworthy before it becomes the assumed default.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] Run provider-focused tests:
  - `tests/ad-source.test.ts`
  - `tests/meta-library-browser.test.ts`
  - `tests/search-provider-route.test.ts`
  - `tests/monitoring-provider.test.ts`
- [ ] Verify `/search` still supports:
  - advertiser mode
  - keyword mode
  - save query
  - create watchlist
- [ ] Verify `app/lib/search-selection.server.ts` still hydrates selected results correctly after the source swap.
- [ ] Verify `app/routes/app.reports.tsx` still renders `watch_event` history correctly after discovery-provider changes.
- [ ] Verify production no longer serves demo data silently when live discovery fails.

## Out Of Scope

- full multi-network expansion beyond Meta's public ad surfaces
- creative-performance prediction
- visual layout diffing
- Slack delivery
- a broad rename from `metaAdId` to a new generic identifier in this same slice
- legal/compliance sign-off language beyond flagging that review is still needed

## Notes

- The correct wedge is still:
  - `See what changed, with proof.`
- This replacement plan changes how ads are discovered.
- It does not change the core product story.

## Sources

- [Meta Ad Library API](https://www.facebook.com/ads/library/api)
- [Meta Help: What is the Meta Ad Library and how do I search it?](https://www.facebook.com/help/259468828226154)
- [Meta Help: See a Facebook Page's ads](https://www.facebook.com/help/314419145702905/)
- [Cloudflare Browser Run Overview](https://developers.cloudflare.com/browser-run/)
- [Cloudflare Browser Run Quick Actions](https://developers.cloudflare.com/browser-run/quick-actions/)
- [Cloudflare Browser Run Puppeteer (CDP)](https://developers.cloudflare.com/browser-run/cdp/puppeteer/)
