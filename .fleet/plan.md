# 0509#2478 — first-scan retry limit exceeds D1 claim cap

manager note: phases 1-6 run in one worker pass — single-file defect fix, splitting adds handoff cost with no review value.

- [x] phase 1: Import FIRST_SCAN_MAX_ATTEMPTS from app/lib/monitoring-fanout.server in workers/monitoring-workflow.ts
- [x] phase 2: Set run-first-watchlist-scan step retry limit to FIRST_SCAN_MAX_ATTEMPTS - 1 (no NonRetryableError change)
- [x] phase 3: Add static assertion test in tests/monitoring-workflow.test.ts that the step limit equals FIRST_SCAN_MAX_ATTEMPTS - 1 (RED with literal 6)
- [x] phase 4: Add GREEN characterization test seeding a watchlist_run with attempt_count = 4, status = 'pending', expecting runFirstWatchlistScanWorkflowJob(...).rejects.toThrow(/owned or exhausted/)
- [x] phase 5: Sweep workers/*.ts (and siblings) for other retry limits exceeding claim caps; fix any instance found in the same PR
- [x] phase 6: Run npx vitest run --configLoader runner --project node tests/monitoring-workflow*.test.ts green; typecheck is CI-owned
Consider: test anchors in tests/monitoring-workflow.test.ts are string-based (import order, indexOf slice) — add a "update anchors if step config is restructured" comment in a follow-up.
Noted: scheduled step literal limit:3 vs SCHEDULED_SCAN_MAX_ATTEMPTS=8 — no cap breach; potential follow-up issue.
- [x] phase 4: CI round 1 failed (TS2741 missing creativeId in test fixture, both codex-node-checks + preview-assert); fixed by adding creativeId:"creative-1"; local run 14/14 GREEN; merged origin/main to resolve .fleet/plan.md conflict.
