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

## Phase 2 (A2) — in progress

`tests/integration/monitoring-pickup.test.ts` — REAL migrations, workspace+user+watchlist via a production creation path, the pickup, a `watchlist_run` row (joined on the watchlist id) plus the digest/all-quiet outcome. See the plan file for the full contract.

## Phase 3 (A3+A4) — pending

PR-body records: no-migration justification, #2919-answered-by-#2908, cross-links, the physically-real termination date-gate (next Monday 03:00Z tick after deploy).
