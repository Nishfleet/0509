# Plan — Offer timeline cohort for sneaker-resale cluster (issue #1946)

Manager mode (heavy). Reuse the existing nightly offer-timeline backfill pattern (issue #1449) and extend it to the populated sneaker-resale cluster. The new cohort is derived from `data/seed-lists/sneaker-resale.json` AND a non-empty verified/likely ad-tier check — never a phantom timeline. Same daily rail, same `captureLandingPageSnapshot` write path, same `landing_page_snapshot` table. No new cron, no new service, no new schema.

## Phases

- [x] phase 1: cohort derivation (pure helper + read-only D1 tier lookup) — `deriveSneakerResaleCohort(seedList, tierByDomain)` in `app/lib/sneaker-resale-cohort.ts` filters seed entries to domains where `verifiedCount + likelyCount >= 1`; `getSneakerResaleTierByDomain(env, domains)` in `app/lib/sneaker-resale-cohort.server.ts` reads only the existing `public_search` cache (no live provider calls, no schema change) and returns `{ domain -> { verified, likely, hasCoverage } }`; a domain with no cache row or `unmatched`-only cache row is `hasCoverage: false`; unit test under `tests/sneaker-resale-cohort.test.ts`.
- [x] phase 2: nightly sneaker-resale backfill — `app/lib/sneaker-resale-backfill.server.ts` with `runSneakerResaleBackfill(env, options?)` mirroring `runDemoBrandBackfill` (same `captureLandingPageSnapshot` write path, same `requireScreenshot: true` semantics, per-brand failure isolation, INSERT OR IGNORE on deterministic id `sneaker-<domain>-<YYYY-MM-DD>`, never a phantom offer); `SneakerResaleBackfillStatus` union + per-domain result type + `summarizeSneakerResaleBackfill(result)` log line; integration test under `tests/integration/sneaker-resale-backfill.integration.test.ts` covering real D1 path.
- [x] phase 3: worker wiring — `workers/app.ts` adds a sibling `ctx.waitUntil` for `runSneakerResaleBackfill` on the same daily rail, with `reportScheduledTaskFailure` escalation; no new wrangler cron; worker-entry-point coverage added to the existing `tests/worker-scheduled-handler.test.ts` (node project, three new cases) per the amendment note below.
- [ ] phase 4: verification + PR — `npx vitest run` green across changed suites, `npx tsc -b` clean on changed files, all PR-body canary scripts exit 0, PR body carries `Verification:` / `run-proof:` / `research:` / `help-first:` receipts; arm `gh pr merge --auto --squash`.

## Files to touch
- `app/lib/sneaker-resale-cohort.ts` (new) — pure cohort derivation.
- `app/lib/sneaker-resale-cohort.server.ts` (new) — read-only D1 tier adapter.
- `app/lib/sneaker-resale-backfill.server.ts` (new) — nightly backfill.
- `workers/app.ts` — sibling `ctx.waitUntil` on the daily rail.
- `tests/sneaker-resale-cohort.test.ts` (new) — phase 1 unit suite.
- `tests/integration/sneaker-resale-backfill.integration.test.ts` (new) — phase 2 real D1 suite.
- `tests/integration/sneaker-resale-backfill.scheduled-rail.test.ts` (new) — phase 3 worker entry-point suite. *Amended: tests added to the existing `tests/worker-scheduled-handler.test.ts` (node project) so the worker entry-point coverage matches the pattern `runDemoBrandBackfill` already uses for issue #1449 (no separate integration file exists for that worker entry-point either).*

## Out of scope
- `app/lib/demo-brand-backfill.server.ts` (untouched).
- `data/seed-lists/sneaker-resale.json` (read-only).
- `app/routes/ads.$domain.tsx` / `app/routes/timeline.$domain.tsx` (write the row, the routes already render the section).
- `migrations/**` / `workers/wrangler.toml` / `.github/workflows/**` (untouched).

## Phase 4 reviewer round (single reviewer pass, seat cursor/cursor-grok-4.6-high)

- **Act on (fixed)**: the nightly tier read gates on `expires_at > now` (15-min public_search TTL) while the publisher is a sibling waitUntil — the backfill would read before the publisher's awaited per-domain writes land and derive an empty cohort (captured=0) every night, so /timeline/:domain would never leave 410. Fixed by chaining `runSneakerResaleBackfill` after the publisher's promise on the same daily block (workers/app.ts), with the catch-up comment documenting the ordering contract; regression tests added (deferred-publisher ordering + publisher-throws best-effort).
- **Warning (fixed)**: a newest-row demo payload `continue`d the whole domain, silently discarding a still-fresh legitimate commercial row. The adapter now falls through to the next-newest non-demo row; regression test added.
- **Suggestion (fixed)**: `summarizeSneakerResaleBackfill` now emits `cohort=N` so an empty-cohort night is visible in the operator log.
- **Suggestion (noted, no change)**: `cacheStatus` on the tier map is informational only — no downstream reader; dropping it would churn tests for no behavior gain.
