# prod-canary searchRolloutMode default — already resolved by PR #685

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-prod-canary-v2-default-already-resolved`
Base: `origin/main` at `422fbd55` (#806)

## Item

- [ ] prod-canary.mjs still defaults to expecting searchRolloutMode "shadow"
  — post-#685 the live product is v2, so a b….

## Verdict

No code change was warranted. The packet's core assumption ("prod-canary.mjs
still defaults to expecting searchRolloutMode 'shadow'") is false against the
live repository state. PR #685 (`70faea05` — "feat(search): promote public
search from shadow to v2 rollout", merged 2026-08-12) already flipped the
default in `scripts/prod-canary.mjs` from `"shadow"` to `"v2"`, updated the
lib normalizer and the propagation waiter, and repinned every other release-
tooling gate (Gate C soak journals/evidence, deploy readiness, remote-restore
evidence, uptime-health workflow, release-soak route) from shadow to v2.
`70faea05` is an ancestor of current `origin/main` HEAD `422fbd55`.

## Evidence on current main

- **CLI/env default is v2**: `scripts/prod-canary.mjs:19` —
  `expectedSearchRolloutMode: process.env.CANARY_EXPECTED_SEARCH_ROLLOUT_MODE || "v2"`.
  This is the exact line the item calls out, and it defaults to `"v2"`.
- **Lib normalizer is v2**: `scripts/prod-canary.lib.mjs:96-101` —
  `normalizeExpectedSearchRolloutMode` returns `"v2"` whenever the passed value
  (option or `CANARY_EXPECTED_SEARCH_ROLLOUT_MODE` env) is missing/blank.
  Both `checkHealthEndpoint` (line 204) and `runProductionCanary` (line 406)
  route all missing-value cases through it.
- **Propagation waiter pins v2**: `scripts/prod-canary.lib.mjs:309` —
  `waitForExpectedWorkerVersion` calls `checkHealthEndpoint` with
  `expectedSearchRolloutMode: "v2"` for every alias sample.
- **Fails closed on shadow live evidence**: `compareReleaseIdentity`
  (`scripts/prod-canary.lib.mjs:185`) reports a rollout-mode mismatch when
  live `searchRolloutMode` differs from the v2 expectation, and the test
  suite pins that: `tests/prod-canary.test.ts:200` ("wrong mode" fixture with
  live `searchRolloutMode: "shadow"` → must fail with "rollout mode
  mismatch").
- **Tests pin v2**: `tests/prod-canary.test.ts:10` —
  `const EXPECTED_SEARCH_ROLLOUT_MODE = "v2"`. Suite: 23/23 pass (below).
- **No caller overrides to shadow**: `npm run canary:prod` is plain
  `node scripts/prod-canary.mjs` (package.json); no workflow sets
  `CANARY_EXPECTED_SEARCH_ROLLOUT_MODE` and nothing passes
  `--expected-search-rollout-mode shadow` anywhere in the repo.
- The only remaining `"shadow"` strings touching search are intentional:
  unit fixtures for the shadow-comparison code path
  (`tests/search-execution.test.ts`, `tests/api.health.route.test.ts`
  normalization cases), a secret-scrubbing fixture reusing the token
  `"shadow\nSECRET_MODE"` (`tests/prod-canary.test.ts:335`), and stale docs
  (`docs/INTEGRATION-2026-07-21.md`). The monitoring-fanout canary's
  `"shadow"` default (`scripts/monitoring-fanout-canary.lib.mjs:8`) belongs to
  the separate monitoring-fanout subsystem, not the prod search canary.

## Verification run (this lane)

Run on current main in this worktree (no product changes; report branch only):

```
$ npx vitest --configLoader runner run tests/prod-canary.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

## Files

- `.lane/reports/lane1-prod-canary-v2-default-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.