# Lane evidence — issue 3380 (branch claim/issue-3380, unit pi-issue-0509-3380)

Resumed from the salvage bank `wip/pi-issue-0509-3380-20260913T213841Z` @ ac2b52c9f (the prior unit run died success/0 after the plan + salvage commits, no PR). Rebased claim onto origin/main cff30e908 — clean; the 63 new main commits touch none of the four key files (verified via `git log`).

## Phase 1 (A1) — DONE 2026-09-14 ~03:40 IST

Root cause (verified against source, not vibes):

- Free-plan scheduled cadence = WEEKLY, Monday 03:00 UTC only — `app/lib/plan-entitlements.ts:324-325` (`WEEKLY_SCAN_UTC_DAY = 1`, `WEEKLY_SCAN_UTC_HOUR = 3`). The 2026-09-11T21:35Z cohort watchlist had no Monday-03:00Z slot yet when the issue was filed Sunday 2026-09-13 — its scheduled run was still in the future.
- The 5-minute promise rides the FIRST-SCAN activation queue (`app/lib/first-watchlist-scan.server.ts`), which was missing on exactly two watchlist-creation paths: bulk-accept (`app/lib/auto-competitor-bulk-accept.server.ts`) and the single suggested-competitor accept route action (`app/lib/watchlist-route-actions.server.ts:970`). All other creation paths (customer-agent, setup-checklist, signup) already queue — after the fix, all four `createWatchlistWithinLimit` production callsites are queue-adjacent (verified by grep over `app/`).
- #2908 disabled nothing: it was the test/telemetry cleanup wipe (the 11→0); the scheduled cadence never lost its Monday slot. #2919's open question (silent data loss vs deliberate cleanup) is answered by #2908 — noted, not re-investigated.

Changes:

- Salvage diff (ac2b52c9f): `queueFirstWatchlistScan` wired into `bulkAcceptSuggestedCompetitors` (bulk-accept) and `handleAcceptSuggestedCompetitorAction` (single accept; the "manual-add" of a suggested competitor). Durable `env.DB` path; no ExecutionContext reaches these signatures.
- Inner-loop fallout caught+fixed: `tests/auto-competitor-suggested-panel.test.ts` exercised the single-accept action against the node project's DB stub (`{ DB: {} }`, no `.prepare`) → 2x `TypeError: ensureDb(...).prepare is not a function` through the new queue call. Fixed with the same module-seam mock the bulk-accept test established (`vi.doMock("~/lib/first-watchlist-scan.server")`) + once-only queue assertions on both `status: "created"` tests.

Proof (inner loop r2):

- `npx vitest run --configLoader runner --project node tests/auto-competitor-suggested-panel.test.ts tests/auto-competitor-bulk-accept.test.ts --reporter=dot` → `Test Files 2 passed (2) / Tests 33 passed (33)`, exit 0.
- Inner loop r1 (pre-fix): `npx vitest run --configLoader runner --project node --changed origin/main` → 1 file failed / 2 tests failed, 198 passed, exit 1 (the two failures above). Fixed in one round.

## Phase 2 (A2) — DONE 2026-09-14

`tests/integration/monitoring-pickup.integration.test.ts` — REAL migrations (apply-migrations.ts), workspace+user seeded via fixtures, watchlist created through the REAL `bulkAcceptSuggestedCompetitors` production path; asserts the first-scan `watchlist_run` row joined on the new watchlist id, then the honest all-quiet outcome (scan `skipped` under `E2E_PROVIDER_NETWORK_DENY=1`, brief refusal `no_evidence`, zero `digest_run` rows).

Two repairs vs the salvage draft (both proven by run, not vibes):

1. Draft filename `monitoring-pickup.test.ts` matched NO vitest project — the workers project includes only `tests/integration/**/*.integration.test.ts`, so the file silently ran nowhere. Renamed; now discovered and green.
2. Draft's `findCreatedWatchlist` matched `name = advertiser` exactly, but competitor-import's `prepareImportRow` names created watchlists `"<targetLabel> watch"` — lookup found null even though creation succeeded. Re-scoped to the seeded per-test user (ids unique per call, storage isolated per file).

Fail-on-main proof (the acceptance's "fails against today's production behavior"): detached worktree at origin/main 65776e216, the test file copied in untracked, workers project single-file run → `Test Files 1 failed (1) / Tests 2 failed (2)`, both `AssertionError: expected null not to be null` on the run-row/watchlist lookup — main's bulk-accept loop never calls `queueFirstWatchlistScan`, so no durable run row exists. Same file on the claim branch: 2 passed. No stash of any repo was touched (temp worktree, untracked copy).

Post-rebase (branch rebased onto origin/main 65776e216): integration test 2 passed; node affected-tests (`--project node --changed origin/main`) 15 files / 200 tests passed — includes the phase-1 seam tests. Commit 7f028ed80.

## Phase 3 (A3+A4) — pending

PR-body records: no-migration justification, #2919-answered-by-#2908, cross-links, the physically-real termination date-gate (next Monday 03:00Z tick after deploy).
