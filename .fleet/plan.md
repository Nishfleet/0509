# Plan — Sitemap-timeline cohort backfill for calendly.com / adspyder.io (issue #1958)

Manager mode (heavy). The nightly offer-timeline backfill rail (issue #1449) covers only the five demo brands plus the sneaker-resale cohort; calendly.com and adspyder.io sit in no cohort, so their indexed /timeline/:domain pages freeze at the seed capture and the "newest dated offer state < 7 days" metric falls to zero. Extend the SAME scheduledTask daily block (no new cron, no new service, no migration) with a bounded cohort derived from the sitemap-listed timeline domains that carry complete proof AND verified ad coverage, reusing the captureLandingPageSnapshot honest-capture path and the sneaker-resale cohort machinery as the shape precedent (PR #1956 / issue #1946).

## Phase 1 — pure cohort helper + read-only D1 adapter (acceptance 3)

- [x] phase 1: pure cohort helper + read-only D1 adapter mirroring deriveSneakerResaleCohort / getSneakerResaleTierByDomain; unit-testable without a DB; a domain whose tier lookup says no verified coverage keeps its honest existing timeline and stays off the cohort.

- `app/lib/sitemap-timeline-cohort.ts` (new, PURE — no D1, no server imports): own types `SitemapTimelineTier { verifiedCount, likelyCount, unmatchedCount, hasCoverage, cacheStatus: "fresh"|"stale" }` and `SitemapTimelineCohortEntry { domain, tier }` (same shape as the sneaker tier, defined locally — do NOT import sneaker types); `canonicalizeSitemapTimelineDomain(input)` (lowercase, trim, strip trailing dot, strip leading `www.`, null for empty/non-string — same contract as sneaker); `timelineDomainFromSitemapPath(path)` returning the registrable domain from a `/timeline/:domain` path (null otherwise) and `timelineDomainsFromSitemapEntries(entries)` (dedupe, preserve order); `deriveSitemapTimelineCohort(domains, tierByDomain, excludedDomains)` — canonicalize each candidate, drop domains in `excludedDomains`, require `tier?.hasCoverage === true` (verified+likely >= 1) — a domain whose tier lookup says no verified coverage keeps its honest existing timeline and stays off the cohort. Match-level predicates come from the shared `~/lib/search-domain-match` (`isVerifiedDomainMatchLevel` / `isLikelyDomainMatchLevel`), same as the sneaker helper.
- `app/lib/sitemap-timeline-cohort.server.ts` (new, read-only D1 adapter): 
  - `loadSitemapTimelineCandidateDomains(env)` — wraps the EXISTING `loadIndexableTimelineEntries(env)` (app/lib/sitemap.server.ts) and maps `SitemapEntry.path` `/timeline/:domain` → domains via `timelineDomainsFromSitemapEntries`. This applies the existing complete-proof gate (snapshotRowHasCompleteProof) + non-ad-destination gate + SITEMAP_TIMELINE_PATH_LIMIT bound for free — the sitemap-listed set is the candidacy set. Missing DB → [].
  - `getSitemapTimelineTierByDomain(env, domains)` — sibling mirror of `getSneakerResaleTierByDomain` (same domain-scoped cache key candidates `search-v2:domain:<domain>:exact:<provider>:all:page-1` for providers meta_api/meta_library_browser/demo, same route_context='public_search', country='all', demo-payload skip, provider rollover = most-recent-fetched row). MANAGER DECISION (recorded for review): do NOT filter `expires_at > now`. The sneaker adapter's expiry gate works because the nightly publisher re-writes those rows that same tick; calendly.com/adspyder.io have NO scheduled writer — a read-only adapter with the expiry gate would find zero fresh rows at 04:00 UTC, derive an empty cohort, and the freeze would persist (the exact failure this issue reports). The coverage verdict is a durable per-domain evidence fact (the payload's ads + domainMatch levels); surface the row's age via `cacheStatus: "fresh"` when `expires_at > now` else `"stale"`, with `hasCoverage` computed from the payload regardless of expiry. Missing DB / missing discovery_cache_entry table → empty Map (degrade, never throw).
  - `sitemapTimelineExcludedDomains()` — static (no D1): `DEMO_BRAND_PAGE_DOMAINS` (app/lib/demo-brand-pages.ts) ∪ the domains of `resolveSeedList(SNEAKER_RESALE_SEED_LIST)` (sneaker seed JSON, exported from app/lib/ads-domain-publisher.server + app/lib/sneaker-resale-backfill.server). Why seeds, not the covered subset: the sneaker RAIL captures any covered seed domain, and uncovered seed domains can never be sitemap-candidates (no proof rows), so excluding the whole seed set is airtight and needs no D1 read. Overlap with demo (nike.com is in both) is fine.
- Unit tests `tests/sitemap-timeline-cohort.test.ts` (node project, d1.server mocked like `tests/sneaker-resale-cohort.test.ts`): canonicalization, path extraction, dedupe, inclusion/exclusion predicate (`hasCoverage: false` stays out; excluded domain stays out), adapter pass-through of tier maps, degrade paths (no DB / missing table / empty domains).

## Phase 2 — nightly timeline-cohort backfill module (acceptance 2)

- [x] phase 2: nightly timeline-cohort backfill module reusing captureLandingPageSnapshot with honest-capture semantics (requireScreenshot: true, per-brand failure isolation, deterministic row id, INSERT OR IGNORE); rows written only with real screenshot + page text.

- `app/lib/sitemap-timeline-backfill.server.ts` (new) mirrors `app/lib/sneaker-resale-backfill.server.ts` exactly: `runSitemapTimelineBackfill(env, options?)` — build cohort = `loadSitemapTimelineCandidateDomains(env)` minus `sitemapTimelineExcludedDomains()` filtered by `deriveSitemapTimelineCohort(tierByDomain = getSitemapTimelineTierByDomain)`; per-brand try/catch isolation; `captureLandingPageSnapshot(env, https://www.<domain>/, { preferRendered: true, requireScreenshot: true, routeContext: "proof_capture", onFailure })` — a row is written ONLY with a real screenshot + page text; a failed capture is a per-brand `capture_failed` (recorded + reported, never fabricated as an offer state); deterministic row id `timeline-<domain>-<YYYY-MM-DD>` via `sitemapTimelineBackfillRowId(domain, day)`; `INSERT OR IGNORE` (a cron retry cannot double-append a day); `replaceAnalysisFields(env, "landing_page", rowId, buildLandingPageAnalysisFields(snapshot))`; `summarizeSitemapTimelineBackfill(result)` log line shaped `sitemap-timeline-backfill day=... cohort=N captured=... failed=... [domain:captured ...]`; missing DB / empty cohort / missing snapshot table → empty degraded result, never a throw. Bounded: an explicit `SITEMAP_TIMELINE_COHORT_CAP` constant (default 200) slices the derived cohort so a future sitemap coverage explosion cannot blow the nightly Browser Run budget.
- `CAPTURE_HOMEPAGE` = `https://www.<domain>/` — the same shape the sneaker rail captures and the same shape the sitemap domain derivation accepts (registrable domain from hostname), so a written row immediately qualifies as a complete-proof sitemap candidate on the next read.
- Inject seams for tests (`now`, `capture`, `tierLookup`, `excludedDomains`, `cohort`, `domains`) — same shape as the sneaker suite.
- Unit tests `tests/sitemap-timeline-backfill.server.test.ts` (node project; d1.server + landing-pages.server mocked via vi.hoisted, identical layout to the sneaker suite): row-id format, summarize shape, no-DB degrade, empty-cohort degrade, per-brand failure isolation (one failing brand does not abort the others), INSERT OR IGNORE idempotency (second run same day → skipped_already_captured), no-phantom-row on `hasCoverage: false`, exclusion keeps demo/sneaker domains out.

## Phase 3 — worker wiring + scheduled-handler tests (acceptance 1 + 5a)

- [x] phase 3: extend the EXISTING daily backfill rail in workers/app.ts (same scheduledTask block — NO new cron, NO new service, NO migration) with a bounded sitemap-timeline cohort: calendly.com and adspyder.io.

- `workers/app.ts`: import `runSitemapTimelineBackfill` + `summarizeSitemapTimelineBackfill`; inside the EXISTING `scheduledTask.kind === "monitoring" && scheduledTask.digestCadence === "daily"` block add a SIBLING `ctx.waitUntil(runSitemapTimelineBackfill(env).then(log with day/cohort/captured/failed/summary, (error) => reportScheduledTaskFailure(env, "sitemap_timeline_backfill", error)))` — alongside runDemoBrandBackfill. MANAGER DECISION (recorded for review): NOT chained after publisherRun like sneaker. Sneaker's chain exists because its tier read gates on 15-min-TTL rows the publisher writes that tick; this cohort's tier read accepts any-age rows (Phase 1 decision), so there is no ordering hazard, a sibling keeps a publisher whole-run failure from coupling to the timeline capture, and runDemoBrandBackfill is the closer sibling shape. No new cron, no other worker changes.
- `tests/worker-scheduled-handler.test.ts` (edit): add the `vi.doMock` for `sitemap-timeline-backfill.server` (runSitemapTimelineBackfill + summarizeSitemapTimelineBackfill) mirroring the sneaker mocks, plus three cases: (a) daily 04:00 cron invokes `runSitemapTimelineBackfill` once AND still invokes demo + sneaker backfills (the cohort expansion must not displace the existing rails); (b) the 3h (WARMUP_CRON) and weekly (NORMAL_CRON) crons do NOT invoke it; (c) a throw pages `reportScheduledTaskFailure(env, "sitemap_timeline_backfill", error)` while the demo backfill still ran.

## Phase 4 — real-D1 integration test (acceptance 5c + 4)

- [x] phase 4: real-D1 integration test applying the capture path against a calendly-like fixture — fresh row with a real screenshot written; no-coverage fixture writes nothing; per-day idempotency; three-night dated-ledger accumulation.

- `tests/integration/sitemap-timeline-backfill.integration.test.ts` (new, workers project, real D1 via `tests/integration/fixtures.ts` + `apply-migrations.ts`, capture stubbed — the real pipeline needs Browser Rendering):
  - Covered fixture: seed one complete-proof snapshot row for a calendly-like REAL registrable domain (e.g. calendly.com — the sitemap domain derivation requires a real registrable hostname) so `loadSitemapTimelineCandidateDomains` candidacy is real; inject `tierLookup` with `hasCoverage: true`; run backfill; assert a fresh `timeline-calendly.com-<day>` row with a real screenshot + page-text artifact key (`screenshotArtifactKey`/`htmlArtifactKey` in metadata) is written and `loadOfferTimeline` renders the new dated state (screenshotHref/pageTextHref `/artifacts/...`).
  - No-coverage fixture: same domain seeded, `tierLookup` `hasCoverage: false` → run writes NOTHING (row count unchanged, seeded timeline untouched, result domains empty).
  - Per-day idempotency (second run → skipped_already_captured); three-night dated-ledger accumulation (3 rows, ascending dates, newest within 7 days); per-brand capture-failure isolation; production-builder path test: real `deriveSitemapTimelineCohort` over seeded sitemap candidates + fixture tier map, with the demo/sneaker exclusion flowing through (`sitemapTimelineExcludedDomains` real).

## Phase 5 — verification + reviewer round + PR

- [x] phase 5: full verification (all suites green, tsc clean, sgscan/crgate/repo tests), live acceptance-4 evidence, PR with Verification/run-proof receipts + reviewer round + arm.

- Run `npx vitest run --configLoader runner --project node tests/sitemap-timeline-cohort.test.ts tests/sitemap-timeline-backfill.server.test.ts tests/worker-scheduled-handler.test.ts tests/sneaker-resale-backfill.server.test.ts` and `npx vitest run --configLoader runner --project workers tests/integration/sitemap-timeline-backfill.integration.test.ts tests/integration/sneaker-resale-backfill.integration.test.ts` — all green.
- `npx tsc -b` clean on changed files. sgscan + crgate + repo tests per the standard gates.
- Live acceptance-4 evidence: the seeded/captured rows make /timeline/calendly.com + /timeline/adspyder.io render a state captured within the last 7 days after the next nightly run (verify against the live page post-deploy); row counts grow daily.
- PR body carries `Verification:` / `run-proof:` receipts + the manager-decision notes (Phase 1 no-expiry tier read + Phase 3 sibling wiring) so the reviewer round can judge them.
- Single reviewer round (seat per `find_senior_seat`), then arm `gh pr merge --auto --squash`.

## Files to touch

- `app/lib/sitemap-timeline-cohort.ts` (new) — pure cohort derivation + path extractors + canonicalizer.
- `app/lib/sitemap-timeline-cohort.server.ts` (new) — read-only D1 adapter: candidate domains (wraps loadIndexableTimelineEntries), tier read (no expiry gate), static exclusion set.
- `app/lib/sitemap-timeline-backfill.server.ts` (new) — nightly capture module: row id, INSERT OR IGNORE, per-brand isolation, summarize, CAP.
- `workers/app.ts` — imports + sibling `ctx.waitUntil` in the existing daily block; failure name `sitemap_timeline_backfill`; no cron changes.
- `tests/sitemap-timeline-cohort.test.ts` (new) — phase 1 unit suite.
- `tests/sitemap-timeline-backfill.server.test.ts` (new) — phase 2 node unit suite.
- `tests/worker-scheduled-handler.test.ts` (edit) — phase 3 worker entry-point cases via the existing vi.doMock pattern.
- `tests/integration/sitemap-timeline-backfill.integration.test.ts` (new) — phase 4 real-D1 suite.

## Out of scope

- `migrations/**`, wrangler cron config, `.github/workflows/**`, verifier/deploy/GitHub paths — untouched (no migration needed; `landing_page_snapshot` already exists).
- `app/routes/timeline.$domain.tsx` + `app/lib/sitemap.server.ts` — reused read-only; the route already renders whatever honest ledger exists.
- `app/lib/sneaker-resale-cohort*.ts`, `sneaker-resale-backfill.server.ts`, `demo-brand-backfill.server.ts`, `ads-domain-publisher.server.ts` — read/reused, NOT modified.
- `data/seed-lists/` — read-only; calendly/adspyder candidacy is sitemap-derived, no new seed list.
- No timeline-cohort proof-hole catch-up; no hourly/daily cron addition; no new service or schema.

## Reviewer rounds

### Phase 1 reviewer round (2026-09-08, seat cursor/cursor-grok-4.6-high)

Diff: `git diff origin/main..HEAD` (plan + cohort helper + adapter + unit suite). All 35 unit tests green before review.

- **Act on (fixed)**: none.
- **Consider (recorded, carried into later phases)**:
  - Retention-decay premise flag: `public_search` rows have a 15-min TTL and the retention job deletes expired discovery_cache_entry rows after a 7-day grace (retention.server.ts:23,129-139). calendly/adspyder have no scheduled writer, so an un-refreshed tier read goes empty ~7 days after the last search-triggered write and the cohort silently reverts to the freeze. The no-expiry gate alone does not keep the cohort alive. Phase 5 must verify the two target domains still surface in the live tier read at current retention state; if the nightly rail must be durable regardless of search traffic, a follow-up (evidence refresh / retention carve-out) is a new issue, not this PR.
  - Sitemap candidacy is oldest-first with an arbitrary cap (sitemap.server.ts:765-768: ORDER BY captured_at ASC LIMIT 100,000 then per-domain first-200). calendly/adspyder could fall outside that window at current table size. Phase 5 must verify both target domains appear in live loadIndexableTimelineEntries output.
  - timelineDomainFromSitemapPath is not total over degenerate paths (/timeline/calendly.com?x=1, #fragment, single-label domains). Can never join the cohort (no matching cache key), so no phantom — Dismissed for this PR; noted for future strictness.
  - Import coupling: the adapter value-imports SNEAKER_RESALE_SEED_LIST from sneaker-resale-backfill.server, dragging its module graph into consumers; the string is a registry key. No worker-bundle cost (sneaker backfill already bundled); Noted, not changed this PR.
- **Noted**: seed-contents contract pin in tests; countSitemapTimelineTier unknown[] drift (harmless); cacheStatus has no consumer yet (phase 2 summarize surfaces it); D1 fan-out 500×3 keys ≈ 17 chunked SELECTs, shrinks to ~7 under phase 2's 200 CAP.
- **Dismissed-with-reason**: lexical expires_at comparison (writers store ISO text; existing SQL gates use the same comparison); demo-row fall-through matches the fixed sneaker precedent; extractor not validating provider segment (SQL constrains candidates); no write path yet to review.

### Phase 2 reviewer round (2026-09-08, seat cursor/cursor-grok-4.6-high)

Diff: `git diff 644c3d38..HEAD` (backfill module + unit suite). 56 tests green (21 new) before review.

- **Act on (fixed)**: none.
- **Consider (recorded, phase-5 review carries)**:
  - CAP slice runs before the `requested`-domains filter (sitemap-timeline-backfill.server.ts:292-293) — a caller requesting a domain beyond cohort position 200 gets a silent no-op. No caller passes `domains` today (phase 3 wires none); future-proofing hygiene, not a bug.
  - Plan note "D1 fan-out shrinks to ~7 under the 200 CAP" is stale: the tier lookup runs over ALL candidate domains (up to 500 → ~1500 keys ≈ 15-17 chunked SELECTs) before the cap. The CAP bounds capture/browser spend (its purpose); the D1 read stays full-size.
  - Missing-snapshot-table degrade returns a result indistinguishable from "no coverage today" in the log (cohort=0 captured=0 failed=0). Consider a `degraded=missing_snapshot_table` marker in the summarize line for ops.
  - `stale=N` counts every processed domain incl. skipped/error rows — document-intended; ops should read it as "evidence age of verdicts that drove today's processing".
- **Noted**: INSERT succeeds before replaceAnalysisFields (error after insert leaves a real row; next run = skipped_already_captured) — inherited sneaker shape; no-phantom default-path test exercises tier absence not explicit false (phase-1 suite + phase-4 fixture cover explicit false); the `as never` casts mirror the sneaker suite.
- **Dismissed-with-reason**: missing-table degrade divergence from sneaker (planned carry-forward, default path can't throw — sitemap.server.ts:748-752 identical degrade); preferRendered without explicit persistArtifacts (pipeline defaults persist); UTC day slicing (matches sneaker + 04:00 UTC cron).

### Phase 3 reviewer round (2026-09-08, seat cursor/cursor-grok-4.6-high)

Diff: `git diff 52d48efa..HEAD` (worker wiring + scheduled-handler tests). 93 tests green (phase-3 suite 22/22) before review. Verifier confirmed DAILY_DIGEST_CRON fidelity and sneaker-chain untouched.

- **Act on (fixed)**: none.
- **Consider (recorded)**:
  - Case (b) fires surrogate cron strings (WARMUP_CRON `17 */6 * * *`, NORMAL_CRON `0 * * * *`) not the literal production 3h/weekly constants (`REGULAR_MONITORING_CRON` `0 */3 * * *`, `WEEKLY_DIGEST_CRON` `0 5 * * MON`). The pin holds only because the mocked resolver maps everything non-daily to non-daily cadence; tightening to loop the literal constants would be a stronger regression pin. Behaviorally airtight today.
  - The mocked resolver's fallback returns weekly cadence for any unknown cron while the real resolver omits digestCadence for hourly/3h — case (b)'s NORMAL_CRON leg exercises the weekly branch, not the real no-cadence branch. Harmless (the gate only discriminates === "daily"), but the label is less honest than it looks.
- **Noted**: test descriptions say "3-hour or weekly" while firing 6-h/hourly strings (inherited from the plan's loose labels; pre-existing suite convention); completion log duplicates day/cohort/captured/failed in fields and summary string (house shape, same in sneaker log).
- **Dismissed-with-reason**: sibling-concurrency race (disjoint row-id namespaces, INSERT OR IGNORE, monitoring captures don't touch the timeline namespace); publisher-failure coupling (sibling is the deliberate manager decision; any-age tier read removes the sneaker chain's ordering hazard); case (c) asserting the exact failure object (same reference flows through the rejection handler).

### Phase 4 reviewer round (2026-09-08, seat cursor/cursor-grok-4.6-high)

Diff: `git diff e02011a9..HEAD` (integration suite). 17 integration tests green (8 new + 9 sneaker coexistence) before review.

- **Act on (fixed)**: none.
- **Consider (recorded, phase-5 carry)**:
  - The real tier adapter getSitemapTimelineTierByDomain is never exercised against real D1 — every run injects tierLookup; the phase-1 retention-decay risk lives exactly in that adapter. The no-coverage fixture proves the backfill honors hasCoverage: false, not that production's adapter emits the correct verdict. Plan-scoped (sneaker sibling shares the gap); phase 5's live tier read verification is the net. If live verification shows the adapter drift, a follow-up issue adds a discovery_cache_entry-seeded fixture test.
  - "Newest within 7 days" assertion is partly fixture-derivative (stub writes its own capturedAt); genuinely pins written captured_at landing ascending + final entry = last night, bounded against run clocks. Frame as a written-timestamp regression guard; phase 5's live run owns the metric.
- **Noted**: `capturedAt = ${day}T0${index+1}:30:00.000Z` produces invalid ISO for index >= 9 (footgun; all indexes used are 0-7; sneaker sibling has the same trap); arrayContaining vs exact toEqual complementarity; per-file cross-test accumulation handled honestly (distinct UTC days + exact id-scoped counts); capture-stub null without onFailure → reasonCode null is the honest contract; exclusion fixture is real (stockx.com/nike.com in the actual seed JSON).
- **Dismissed-with-reason**: "real screenshot" is a stub key not browser-rendered (Browser Rendering explicitly out of CI scope, sneaker precedent; hex32 keys pass the real proof validators, so the href assertions stay honest); `as never` casts (sneaker shape); fixed fixture dates (all now injected, zero wall-clock dependence); hasCoverage: true for excluded domains in the covered fixture (forces the real static exclusion to do the dropping — the exact regression the exclusion test must prove).

### Phase 5 reviewer round (single reviewer pass, seat cursor/cursor-grok-4.6-high, 2026-09-08)

Diff: `git diff origin/main..HEAD` (four phases + phase-5 test pin). 93 node tests + 17 real-D1 integration tests green before review; reviewer re-ran both projects (7338 node / 191 workers) and confirmed green. Fork-point corruption check: branch rebased onto origin/main 2026-09-08 — the pre-rebase stale-tree diff (search-latency deletions) was a fork-point artifact; post-rebase diff touches only workers/app.ts + app/lib (3 new files) + tests + .fleet/plan.md.

- **Act on (fixed)**: none.
- **Warning (fixed)**: none.
- **Suggestion (fixed)**: the scheduled-handler "does not run on the 3h or weekly crons" case fired surrogate strings (WARMUP_CRON 6-hourly, NORMAL_CRON hourly), not the literal REGULAR_MONITORING_CRON / WEEKLY_DIGEST_CRON constants the acceptance names. Pinned to the literal constants (1f9748e4, phase-5 worker retry); suite 22/22 green.
- **Consider (recorded, follow-up candidates — all non-blocking hybrids of phase-1/2/4 carries)**: (1) the real D1 tier adapter getSitemapTimelineTierByDomain is never exercised against real D1 (every integration run injects tierLookup) — no-coverage fixture proves the backfill honors hasCoverage:false, not that production's adapter emits the right verdict; live acceptance-4 verification is the residual net, a discovery_cache_entry-seeded fixture is a follow-up issue candidate. (2) missing-landing_page_snapshot-table degrade logs identically to a quiet night (cohort=0 captured=0 failed=0) — a degraded=missing_snapshot_table marker in the summarize line is a follow-up candidate. (3) CAP slice runs before the domains-subset filter — no caller passes domains today, future hygiene only.
- **Noted**: manager decision 1 (no-expiry tier read) is sound — calendly/adspyder have no scheduled writer, an expiry gate would empty the cohort at night and perpetuate the freeze; verdict is a durable evidence fact, age surfaced via cacheStatus fresh/stale; the sneaker SQL gate uses the same lexical expires_at comparison. Manager decision 2 (sibling, not chained after publisher) is sound for a sharper reason than the plan recorded: the only same-tick publisher writes are seed-list domains and the entire seed list sits in the static exclusion set, so no same-tick-dependent row can be a cohort candidate; residual first-tick races self-heal in one night.
- **Dismissed-with-reason**: stale-verdict nightly captures are not a phantom-timeline vector (the verdict only gates inclusion; the written row is a real screenshot + page text of the page's current state); sibling read missing same-tick publisher coverage (target rows written by non-nightly paths; publisher seeds all excluded); missing-table degrade divergence from sneaker (planned carry, default path must never throw, failure channel stays live).