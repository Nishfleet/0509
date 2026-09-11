# lane: claim/issue-2452

- scope: e2e-j6-retention-replay stale-claim reclaim + leftover fixture tolerance (issue #2452, finding M21).
- RED: `npx vitest run tests/e2e-j6-retention-replay.route.test.ts` on the pre-fix file -> 2 failed / 1 passed (stale claim returned 409, leftover fixture returned 503).
- GREEN: same command after the fix -> 3 passed; `npx vitest run --configLoader runner --project node --changed origin/main` -> 2 files / 8 tests passed.
- fix: `claimReplayAction` ports the team replay's 30s stale-claim CAS reclaim verbatim; `createRetentionFixture` delete-then-inserts the same viewport+clock fixture key.
- typecheck: not run locally (repo rule — CI owns `npm run typecheck`).
