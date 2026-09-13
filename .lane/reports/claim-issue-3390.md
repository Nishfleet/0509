# Lane evidence — claim/issue-3390 (Nishfleet/0509#3390)

deploy: post_deploy_recovery_failed after SUCCESSFUL deploy+rollback — 3rd
occurrence 2026-09-13 (runs 34626446693, 34759554622, 34770115098; Deploy
Worker job only, every other job SUCCESS).

Provenance: this unit's first run banked
`wip/pi-issue-0509-3390-20260913T193314Z` @ 8fcd1b252 (salvage, issue
comment; judge cursor-grok-4.6-high: "next worker MUST resume that branch,
not restart from main"). This session resumed it (claim/issue-3390,
re-claimed 20:52:27Z), rebased onto origin/main (bd41132f7, clean), then
finished the acceptance.

Failure classification (17:36Z, run 34770115098, Deploy step 17:36:42.657Z):
the wrangler rollback printed SUCCESS + `Current Version ID: 515fb9d2…`
yet the spawn exited non-zero; the old script's
`if (result.status !== 0) throw` fired AFTER the swap had landed, the plan
wrapper rethrew `post_deploy_recovery_failed`
(deploy-production-plan.mjs:809 AggregateError), and the Deploy Worker job
went red on a recovered release. Because the failure exited the step, the
success-only chain (Worker secrets sync, release-evidence verify, the
on-main deploy ledger record) never ran — which Worker version went live
was recorded nowhere.

Delta (on the salvaged commit — 5 files):

- MOD `scripts/rollback-production.mjs` — (a) when the resolved target IS
  the version the failed deploy placed at 100%, there is nothing to
  recover: skip the wrangler spawn, record the live version, exit 0;
  (b) the spawn's stdout is piped and echoed so the swap is provable from
  wrangler's own final `Current Version ID:` line; (c) the
  `interpretWorkerRollbackSpawn` verdict — exit 0 → `rolled_back`; non-zero
  exit but the marker names the chosen target →
  `rolled_back_although_spawn_exited_nonzero`, still ok; otherwise
  `worker_rollback_not_confirmed` (fails loud); (d) the recovered evidence
  (`recoveredLiveVersionId`, recovery outcome, timestamp) is written back
  to the rollback-target evidence file.
- MOD `scripts/worker-rollback-target.mjs` — the new
  `interpretWorkerRollbackSpawn` (marker-vs-exit adjudication, expected
  version guarded by the existing SAFE_IDENTIFIER_PATTERN).
- MOD `scripts/deploy-production-plan.mjs` — when recovery succeeds the
  plan NO LONGER rethrows: it writes
  `post_deploy_recovery_complete — <step> failed, last-green restored:
  <msg>` to stderr and continues, so the later release checks, the Worker
  secrets sync, the release-evidence verify and the on-main deploy ledger
  record finally run; the AggregateError is kept when the recovery itself
  fails.
- MOD `scripts/deploy-ledger.mjs` — the ledger records the LIVE
  (recovered) version: `recoveredLiveVersionId` from the evidence file
  wins over the deployed-then-rolled-back id.
- ADD `tests/rollback-recovery-exit-zero.test.ts` — replays the 17:36Z
  signature end-to-end (a fake WRANGLER_BIN that prints the SUCCESS
  banner + `Current Version ID:` marker and exits 1), the
  exit-0 + recorded-live-version assertion, the skip-recovery path
  (target already 100% live → recorded, exit 0), the recovered-canary
  continuation, the AggregateError-when-recovery-itself-fails, and the
  ledger's recovered-version preference.

Contract update (9 readiness-gate tests) —
`executeProductionDeployPlan`'s recovered-release behavior changed from
rethrow to continue, so `tests/deploy-production-gate.test.ts` followed:
the 8 `it.each` rows + the post-canary invariant test now expect
`caught === undefined`, the next release check to RUN (that is the point —
the ledger record lives downstream), and the post-canary invariant to run
twice (once inside the recovery, then again when the loop resumes past
the canary). Same scoped suite: 9 failed / 137 passed before the contract
update, 146/146 after.

Evidence (this session, 2026-09-14):

    $ npx vitest run --configLoader runner --project node --reporter=dot \
        tests/rollback-recovery-exit-zero.test.ts \
        tests/worker-rollback-target-existing.test.ts \
        tests/verify-post-deploy-release.test.ts \
        tests/deploy-production-gate.test.ts \
        tests/deploy-age-detector.test.ts tests/gate-c-soak.test.ts \
        tests/production-candidate-workflow.test.ts \
        tests/workspace-member-preflight.test.ts
    Test Files  8 passed (8)
    Tests  146 passed (146)

Acceptance note: the 17:36Z-signature test passes on this PR. The next real
Deploy Worker run completes the issue's second acceptance (green, or exits 0
when there is nothing to recover) — that run is only possible after this PR
merges, so it is a post-merge verification, not this PR's.
