## Offer timeline (BET 3 differentiator) for the populated sneaker-resale cluster (issue #1946)

The nightly Offer Timeline backfill (issue #1449) was scoped to the 5 hard-coded demo brands. Issue #1946 extends the same nightly backfill to the populated sneaker-resale cluster — the seven-day-running market-signal buyer's cluster (StockX, Foot Locker, Stadium Goods, Flight Club, Hypebeast, Saucony, …) — so the `/ads/<brand>` pages and `/timeline/<brand>` endpoints that already exist for the cluster finally surface dated offer states instead of 410. A brand with no verified/likely ad row keeps the honest 410 shell — no phantom timeline.

### What changed

Phase 1 — cohort derivation (`app/lib/sneaker-resale-cohort.ts` + `app/lib/sneaker-resale-cohort.server.ts`):

- **`deriveSneakerResaleCohort(seedList, tierByDomain)`** — pure helper. Takes the bundled `data/seed-lists/sneaker-resale.json` and a `{ domain → { verified, likely, hasCoverage } }` map; returns the cohort whose `hasCoverage` is `true`. Excludes duplicate seed domains, missing tier entries, and any domain whose tier entry has `unmatchedCount` only.
- **`getSneakerResaleTierByDomain(env, domains)`** — read-only D1 adapter. Reads only the existing `public_search` discovery cache rows (the BET 5 publisher's write path) with `route_context = 'public_search' AND country = 'all' AND expires_at > now`. Skips `payload.source === 'demo'` rows, expired rows, and tables that aren't migrated yet (returns an empty `Map`, never throws). Provider-rollover-safe: surfaces the freshest row per domain.
- **`canonicalizeSneakerResaleDomain`** mirrors the publisher's `validateSeedList` so `WWW.StockX.com` and the cache key for `stockx.com` compare equal.
- 21-test unit suite (`tests/sneaker-resale-cohort.test.ts`): every branch — covered brand, missing cache row, only-unmatched, empty seed list, www./case normalization, deduplication, the bundled 25-domain seed list end-to-end, plus the D1 adapter happy / missing-DB / empty-domains / missing-table / demo-source / SQL-shape paths.

Phase 2 — nightly backfill (`app/lib/sneaker-resale-backfill.server.ts`):

- **`runSneakerResaleBackfill(env, options?)`** mirrors `runDemoBrandBackfill` exactly — same `captureLandingPageSnapshot` write path with `preferRendered: true`, `requireScreenshot: true`, `routeContext: "proof_capture"`, and the `onFailure` callback that captures `reasonCode`. Same `INSERT OR IGNORE` into `landing_page_snapshot` with the byte-identical column list (matches `createLandingPageSnapshot` in `app/lib/data/ads.server.ts`). Same `replaceAnalysisFields(env, "landing_page", rowId, buildLandingPageAnalysisFields(snapshot))` step.
- Deterministic row id `sneaker-<domain>-<YYYY-MM-DD>` — `INSERT OR IGNORE` swallows a cron retry without double-appending a day.
- Per-brand failure isolation: a brand whose capture returns null ends `capture_failed` with a captured `reasonCode`; a brand whose capture throws ends `error`. Neither aborts the cohort siblings.
- Cohort path: `resolveSeedList("sneaker-resale") → getSneakerResaleTierByDomain → deriveSneakerResaleCohort`. A brand whose `deriveSneakerResaleCohort` returns `hasCoverage: false` is excluded before `capture()` is ever called — no phantom offer.
- Test seams: `options.cohort` (skip the seed-list → tier-lookup → derive path), `options.tierLookup` (skip the D1 tier call), `options.domains` (caller-supplied subset). All seams are honored only when supplied; production code paths never read them.
- **`runSneakerResaleProofHoleCatchUp`** — issue-#1919 mirror; returns a degraded `SneakerResaleProofHoleCatchUpResult` when every cohort brand already has a public timeline.
- **`summarizeSneakerResaleBackfill`** — log-line shape mirrors `summarizeDemoBrandBackfill` (`sneaker-resale-backfill day=YYYY-MM-DD captured=N failed=M [<domain>:captured|<domain>:failed:<reason>|<domain>:error]`) so an operator can grep for it on the daily rail.
- 15-test node suite (`tests/sneaker-resale-backfill.server.test.ts`) + 9-test real-D1 integration suite (`tests/integration/sneaker-resale-backfill.integration.test.ts`).

Phase 3 — worker wiring (`workers/app.ts`):

- New sibling `ctx.waitUntil(runSneakerResaleBackfill(env))` block on the daily rail (`scheduledTask.kind === "monitoring" && scheduledTask.digestCadence === "daily"`), positioned between the BET 5a publisher block and the `scheduled_monitoring` block.
- Same gate as `runDemoBrandBackfill` and `runAdsDomainPublisher` — a new wrangler cron would escape the four-cron release-soak CHECK, so the cohort expansion rides the existing rail.
- Failure escalation: `reportScheduledTaskFailure(env, "sneaker_resale_backfill", error)` — operator pages on whole-run throw. Per-brand failures stay inside the backfill (logged + counted), never escape as a page.
- 3 new tests in `tests/worker-scheduled-handler.test.ts`: (a) daily cron invokes BOTH backfills as siblings, (b) 3-hour / weekly crons do NOT invoke the new backfill, (c) operator pages on `sneaker_resale_backfill` failure while `demo_brand_backfill` still runs (per-brand-failure-isolation check).
- **Supplemental fix (phase-4 reviewer, Act on):** the nightly cohort verdict reads the publisher's `public_search` cache rows, which carry a 15-minute TTL; as a sibling waitUntil the backfill would read before the publisher's awaited per-domain writes land and derive an empty cohort every night. `runSneakerResaleBackfill` is now chained after `runAdsDomainPublisher`'s promise on the same daily block (a publisher whole-run failure still runs the backfill best-effort and pages via its own block). Two regression tests in the scheduled handler (deferred-publisher ordering, publisher-throws best-effort) + one cohort fall-through test; `summarizeSneakerResaleBackfill` now emits `cohort=N`.

Phase 4 — verification (this PR):

- `npx vitest run --project node` and `npx vitest run --project workers` both green across all 4 affected suites (cohort unit, backfill unit, integration, scheduled-handler). 56 node-project tests + 9 worker-project tests added/changed; full repo suites also green (node 606 files / 7227 tests, workers 35 files / 181 tests).
- `npx tsc -b` exit 0.
- No new migrations, no new wrangler cron, no `.github/workflows/**` changes. `landing_page_snapshot` schema untouched.

### Plan

`.fleet/plan.md` (manager mode, 4 phases):

```
- [x] phase 1: cohort derivation (pure helper + read-only D1 tier lookup)
- [x] phase 2: nightly sneaker-resale backfill
- [x] phase 3: worker wiring
- [x] phase 4: verification + PR
```

### Phase reviewer outputs (manager mode run-proof)

Phase 1: pre-existing in the worktree (green on entry, 21/21 cohort unit tests passed).
Phase 2 reviewer (`reviewer` subagent): "No findings in Act on bucket. Two Consider items: (a) integration test uses `hypebeast.com` for the no-phantom-row case but that domain is not in the bundled seed list, so the missing-tier branch — not the hasCoverage branch — drops the brand; (b) `options.domains` Set was trim()/lowercase() only, not canonicalized." Both fixed in commit `26fcfa32 fix(sneaker-resale-cohort): address phase 2 reviewer findings`.
Phase 3 reviewer (`reviewer` subagent): "No Act on findings. One Consider about three identical `if (scheduledTask.kind === "monitoring" && scheduledTask.digestCadence === "daily")` guards (out of scope — mirrors existing publisher and demo-brand block shape). One Noted about a stale `.fleet/plan.md` description line; fixed in the phase-3 tick commit."
Phase 4 reviewer (`reviewer` subagent, seat cursor/cursor-grok-4.6-high): "The sneaker cohort will be empty on essentially every nightly run — bullet 4 (timeline HTTP 200) is not achievable as wired." Act on (fixed, commit `e36f2e18`): chain the backfill after the publisher's promise on the same daily block + 3 regression tests. Warning (fixed): demo-payload fall-through to next-newest legitimate row. Suggestion (fixed): `cohort=N` in the summary line. Suggestion (Noted, no change): `cacheStatus` field is informational only. No Dismissed findings.

Also included: `c0ddb959` fixes a pre-existing month-locked assertion in `tests/integration/mention-digest-resweep.integration.test.ts` (`2026-08-` hard-coded; key embeds now−168h, so it broke on the September rollover and red-flagged every PR's codex-node-checks/preview-assert since 2026-09-01 — including sibling claims 1945/1947). Derives the expected date from the same clock expression the code uses. Test-only, no production behavior.

### Verification

```
$ npx vitest run --configLoader runner --project node tests/sneaker-resale-cohort.test.ts tests/sneaker-resale-backfill.server.test.ts tests/worker-scheduled-handler.test.ts
 Test Files  3 passed (3)
      Tests  56 passed (56)

$ npx vitest run --configLoader runner --project workers tests/integration/sneaker-resale-backfill.integration.test.ts tests/integration/mention-digest-resweep.integration.test.ts
 Test Files  2 passed (2)
      Tests  15 passed (15)

$ npx vitest run --configLoader runner --project node
 Test Files  606 passed (606)
      Tests  7227 passed (7227)

$ npx vitest run --configLoader runner --project workers
 Test Files  35 passed (35)
      Tests  181 passed (181)

$ npx tsc -b --noEmit
EXIT: 0

$ git diff --stat origin/main..HEAD
 .fleet/plan.md                                     |  67 ++-
 app/lib/sneaker-resale-backfill.server.ts          | 437 ++++++++++++++++
 app/lib/sneaker-resale-cohort.server.ts            | 235 +++++++++
 app/lib/sneaker-resale-cohort.ts                   | 155 ++++++
 pr-body.md                                         | 102 ++--
 .../mention-digest-resweep.integration.test.ts     |   8 +-
 .../sneaker-resale-backfill.integration.test.ts    | 478 ++++++++++++++++++
 tests/sneaker-resale-backfill.server.test.ts       | 554 +++++++++++++++++++++
 tests/sneaker-resale-cohort.test.ts                | 493 ++++++++++++++++++
 tests/worker-scheduled-handler.test.ts             | 159 ++++++
 workers/app.ts                                     |  32 +-
 11 files changed, 2652 insertions(+), 68 deletions(-)

$ PATH="/home/nish/workspaces/tooling/fleet-ops/bin:$PATH" prove-one-run-check --body pr-body.md --name-status -
EXIT: 0
```

run-proof: `npx vitest run --project node tests/sneaker-resale-cohort.test.ts tests/sneaker-resale-backfill.server.test.ts tests/worker-scheduled-handler.test.ts` → 3 files / 56 tests passed; `npx vitest run --project workers tests/integration/sneaker-resale-backfill.integration.test.ts tests/integration/mention-digest-resweep.integration.test.ts` → 2 files / 15 tests passed; full `npx vitest run --project node` → 606 files / 7227 tests passed; full `npx vitest run --project workers` → 35 files / 181 tests passed; `npx tsc -b --noEmit` exit 0.

research: no external libraries or APIs introduced; the cohort expansion reuses the existing `captureLandingPageSnapshot` write path, the existing `landing_page_snapshot` table, the existing `public_search` discovery cache, and the existing daily cron. Compared vs the existing `app/lib/demo-brand-backfill.server.ts` (issue #1449) and adopted the same shape; the only structural difference is the cohort source (`data/seed-lists/sneaker-resale.json` filtered by tier verdict instead of `DEMO_BRAND_PAGE_DOMAINS`).

help-first: no new `bin/` files, no new CLI tools. Read `workers/app.ts` to find the existing daily-rail pattern (`runDemoBrandBackfill`, `runAdsDomainPublisher`), read `app/lib/demo-brand-backfill.server.ts` to find the capture + INSERT OR IGNORE shape, read `app/lib/ads-domain-publisher.server.ts` (`SEED_LISTS["sneaker-resale"]`) to confirm the seed list is registered, and reused all of them. The acceptance bullet explicitly forbids a new service / new cron / new schema.

Closes #1946
