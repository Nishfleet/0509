# Lane evidence — claim/issue-2461 (Nishfleet/0509 issue 2461)

Unit: pi-issue-0509-2461. Scope: finding M31/F3 — scheduled presence polling
hardcoded `connector_id = 'website'`; `source_target` CHECK widened for 'rss'.

## Runs (executed in-session, local real D1 workers project)
- RED before code change:
  `npx vitest run --configLoader runner --project workers tests/integration/presence-poll-targets.integration.test.ts`
  → 2 failed | 1 passed:
  - `returns an active 'x' source_target, not just website rows` FAIL (only website rows returned)
  - `accepts an 'rss' source_target row` FAIL (`CHECK constraint failed: connector_id IN ('website','x','reddit','linkedin')`)
- GREEN after:
  - same file + `tests/integration/presence-migration-0093.integration.test.ts` → 2 files / 4 tests passed
  - `npx vitest run tests/presence-` → 144 passed
  - `npx vitest run --configLoader runner --project node --changed origin/main` → 84 files / 1033 tests passed
  - `tests/worker-scheduled-handler.test.ts tests/retention-schedule.test.ts` → 26 passed
- sgscan: "No new security findings."
- typecheck: not run in-worker (MemoryMax=4G budget rule, fleet-ops#4891); PR CI is the typecheck.

## Reviewer adjudication (round 1, seat opencode/nemotron-3-ultra-free)
- Act on (BLOCKING): missing lane evidence file → this file.
- Act on: RED→GREEN evidence not visible to the read-only reviewer seat → recorded here and in the PR body (runs above).
- Consider (recorded, no change): feeder can be crowded by rollout-gated-off targets; each skipped target costs a getTrackedEntity + gate query + cursor write and rotates — correct-by-design per the finding; revisit at rollout expansion.
- Consider (recorded, no change): `not.toContain("connector_id = 'website'")` string assertion could be a regex; substance covered by the integration repro.
- Noted: migration 0093 verified data-preserving and expand-only against the real schema; scope clean.

## CI
CI (checks on PR) is the typecheck + full-suite pass; link: see PR #2794 checks.
