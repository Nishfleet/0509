# Plan — Offer timeline cohort for sneaker-resale cluster (issue #1946)

Manager mode (heavy). Reuse the existing nightly offer-timeline backfill pattern (issue #1449) and extend it to the populated sneaker-resale cluster. The new cohort must be derived from `data/seed-lists/sneaker-resale.json` AND a non-empty verified/likely ad-tier check — never a phantom timeline. Same daily rail, same `captureLandingPageSnapshot` write path, same `landing_page_snapshot` table. No new cron, no new service, no new schema.

## Goal

Make `/timeline/<brand>.com` return HTTP 200 with dated offer states (and `/ads/<brand>.com` render the "Offer timeline" section) for every sneaker-resale cluster brand that has ≥1 verified/likely ad row, by running the same nightly capture the demo brands already use, scoped to that cohort.

## Acceptance-driven phases

- [ ] phase 1: cohort derivation (pure helper + read-only tier lookup) — pure `deriveSneakerResaleCohort(seedList, tierByDomain)` in `app/lib/sneaker-resale-cohort.ts` that filters seed entries to domains with `verifiedCount + likelyCount >= 1` (reuse `classifySeedListVerdict` from `app/lib/ads-domain-publisher.server.ts`); read-only `getSneakerResaleTierByDomain(env, domains)` adapter in `app/lib/sneaker-resale-cohort.server.ts` that queries the existing `public_search` cache (one row per domain, the same row the BET 5 publisher wrote; no live provider calls, no schema change) and returns `{ domain -> { verified, likely, hasCoverage } }`; a domain with no cache row or `unmatched`-only cache row is `hasCoverage: false`; unit test under `tests/sneaker-resale-cohort.test.ts` covers (a) seed list filter respects both inputs (b) brand without cache row is excluded (c) brand with `verified=1, likely=0` is included (d) brand with `verified=0, likely=0, unmatched=3` is excluded (e) empty seed list → empty cohort.
- [ ] phase 2: nightly sneaker-resale backfill — `app/lib/sneaker-resale-backfill.server.ts` with `runSneakerResaleBackfill(env, options?)` mirroring `runDemoBrandBackfill` (same `captureLandingPageSnapshot` write path, same `requireScreenshot: true` semantics, per-brand failure isolation, INSERT OR IGNORE on deterministic id `sneaker-<domain>-<YYYY-MM-DD>`, never a phantom offer); calls `getSneakerResaleTierByDomain` for the seed list, then iterates only the cohort; a `SneakerResaleBackfillStatus` union + `SneakerResaleBackfillDomainResult` interface + `summarizeSneakerResaleBackfill(result)` human log line; honor the same env.DB-missing degraded-empty-result pattern; integration test under `tests/integration/sneaker-resale-backfill.integration.test.ts` asserting (a) the stub-capture path lands rows in the real `landing_page_snapshot` table, (b) a brand with no tier coverage is skipped at cohort derivation (no row written), (c) a per-brand capture failure is recorded but does not abort the other brands, (d) the deterministic id keeps a cron re-run from double-appending a day, (e) the row passes the public-timeline proof gate (loads via `loadOfferTimeline`).
- [ ] phase 3: worker wiring — `workers/app.ts` imports `runSneakerResaleBackfill` + `summarizeSneakerResaleBackfill` next to the demo-backfill import; in the same daily rail block (`scheduledTask.kind === "monitoring" && scheduledTask.digestCadence === "daily"`) fire the sneaker-resale backfill in a sibling `ctx.waitUntil` after the demo-brand backfill, with the same `reportScheduledTaskFailure` escalation; no new wrangler cron (releases soak CHECK is unchanged); an integration test under `tests/integration/sneaker-resale-backfill.scheduled-rail.test.ts` proves the worker entry point invokes the sneaker backfill on the daily rail with the same degraded-on-missing-DB semantics the demo rail uses.
- [ ] phase 4: verification + PR — `npx vitest run --project node tests/sneaker-resale-cohort.test.ts` (green), `npx vitest run --project workers tests/integration/sneaker-resale-backfill.integration.test.ts tests/integration/sneaker-resale-backfill.scheduled-rail.test.ts` (green against real D1 + real migrations), `npx vitest run --project node` (no other test moved), `npx tsc -b` (clean on changed files), `bin/fleet-exec-review-canary` + `bin/prove-one-run-check` + `bin/fleet-no-agent-names-check` + `bin/fleet-rebuild-verify-check` + `bin/research-before-build-check` + `bin/fleet-organ-heartbeat-check` all exit 0; PR body carries `Verification:`, `run-proof:`, `research:`, `help-first:` receipts + reviewer round + reviewer seat name + bucket adjudications per `~/.pi/agent/skills/review-adjudication/SKILL.md`; arm `gh pr merge --auto --squash`; termination command in the issue body (`curl … /timeline/stockx.com = 200` AND `grep Offer timeline on /ads/stockx.com`) is left to the deploy arm — note that in the PR body.

## Files to Modify
- `app/lib/sneaker-resale-cohort.ts` (new) — pure cohort derivation, exported.
- `app/lib/sneaker-resale-cohort.server.ts` (new) — read-only D1 adapter for the `public_search` cache tier lookup.
- `app/lib/sneaker-resale-backfill.server.ts` (new) — nightly backfill mirroring `runDemoBrandBackfill`.
- `app/lib/ads-domain-publisher.server.ts` — reuse `classifySeedListVerdict` for the >= 1 publish floor (already exported; no change expected).
- `workers/app.ts` — sibling `ctx.waitUntil` on the existing daily rail; no cron change.
- `tests/sneaker-resale-cohort.test.ts` (new) — phase 1 unit suite.
- `tests/integration/sneaker-resale-backfill.integration.test.ts` (new) — phase 2 real D1 suite.
- `tests/integration/sneaker-resale-backfill.scheduled-rail.test.ts` (new) — phase 3 worker entry point suite.

## New Files
None outside the ones listed above.

## Risks
- **Live provider calls must NOT happen here.** The cohort lookup reads only the existing `public_search` cache (the publisher's own write); a brand whose cache row has expired or never existed is `hasCoverage: false` and is excluded — exactly the "no phantom offers" rule. If the cache shape changes, the test must fail loudly (assert the JSON columns it reads).
- **No new schema.** Reuse the existing `landing_page_snapshot` table; the deterministic row id is `sneaker-<domain>-<YYYY-MM-DD>` (different prefix from `demo-` so the two rails never collide); INSERT OR IGNORE keeps a cron retry safe.
- **D1 schema rule.** No migration file is added or touched; the D1 expand/contract rules do not apply to this diff.
- **Verifier/deploy protection.** No `workers/wrangler.toml`, `app/lib/verifier*`, `app/lib/deploy*`, or `.github/workflows/**` file is touched.
- **Per-brand isolation.** A failed capture for one brand must not abort the cohort; the loop must mirror the demo backfill's `try/catch` and the per-domain result enum.
- **Daily rail scope.** The two crons (demo + sneaker-resale) share the same `scheduledTask.kind === "monitoring" && scheduledTask.digestCadence === "daily"` branch. The sneaker pass is added as a SECOND `ctx.waitUntil` so the demo summary's `console.log` line is untouched and the release-soak CHECK still sees exactly the four production crons.
- **Cost guard.** `runSneakerResaleBackfill` is bounded by the seed list (25 domains) and gated to the cohort (typically 6-12 domains after the tier filter). No `ADS_DOMAIN_PUBLISHER_CAP` analogue is needed — the seed list is already small and the tier filter shrinks it further. No new env var.
- **Brand-page domain normalization.** The cohort derivation must use the same lowercased / `www.`-stripped host the publisher uses (`classifySeedListVerdict` is value-based so normalization belongs in the lookup adapter, not in the pure helper).

## Out of scope (deliberately not touched)
- `app/lib/demo-brand-backfill.server.ts` — the demo rail stays exactly as it is; this PR adds a sibling, not a refactor.
- `data/seed-lists/sneaker-resale.json` — the issue body references it; no change.
- `app/lib/ads-domain-publisher.server.ts` (`publishSeedListDomain`) — the publisher's live call is unchanged; the cohort just consumes its cache write.
- `app/routes/ads.$domain.tsx` and `app/routes/timeline.$domain.tsx` — both already render the "Offer timeline" section from `loadOfferTimeline` rows; writing the row is sufficient to make them 200/render the section. No route change.
- `app/lib/offer-timeline.server.ts` and `app/lib/landing-pages.server.ts` — public timeline loader + capture pipeline are reused as-is.
- `migrations/**` — zero migration changes.
- `workers/wrangler.toml` / `.github/workflows/**` — zero deploy / CI changes.
