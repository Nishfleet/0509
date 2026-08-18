# Lane 1 — deploy remote_main_drift item: already resolved on main (evidence record)

**Item**: Stop Deploy production from dying on remote_main_drift after a full green gate when main moves mid-run [scout 2026]

**Verdict**: Already implemented and merged. Evidence record only; no product code touched.

## What the investigation found

The full fix is on `origin/main`:

- **PR #556** (`c3539abb`, 2026-08-09) — `scripts/ci-verify-provider-main-cas.sh` gained the opt-in `TOLERATE_MAIN_DRIFT=1` downgrade that converts only the drift condition into a "deploying pinned SHA behind main" note (every other CAS failure stays fail-closed). Set on the two post-gate checks that existed then.
- **PR #630** (`f5aabf14`, 2026-08-11) — extended `TOLERATE_MAIN_DRIFT=1` to every remaining post-pin CAS step in `deploy-production.yml` (deploy job's "Verify pinned candidate before repository and secret work", prepare job's "Verify pinned candidate before self-hosted work", generate job's "Reconfirm frozen main before evidence mutation") plus the plan's `reconfirm_frozen_main_before_deploy` in `scripts/deploy-production-plan.mjs`.

Verified: both commits are ancestors of `origin/main` (`git merge-base --is-ancestor`, true). The `pin_candidate` initial pin remains fail-closed on drift, by design.

Deliberately unchanged: `d1-remote-restore-evidence.yml`'s three "Reconfirm frozen main" steps and `d1-backup-r2.yml` stay fail-closed on drift — these are unattended/nightly D1 mutation drills where proceeding on a moved main is unsafe, and `tests/d1-remote-restore-evidence.test.ts` pins their env exactly (`{ GH_TOKEN }`, no drift flag).

## Verification

```
$ npx vitest run --configLoader runner tests/production-candidate-workflow.test.ts tests/deploy-production-gate.test.ts
 Test Files  2 passed (2)
      Tests  47 passed (47)
```

These are the exact tests that pin the drift-tolerant behavior (#556/#630 added the assertions).

## Deliverables

- Branch `0509-lane1-deploy-drift-evidence` pushed; PR **#726** opened: https://github.com/nish3451/0509/pull/726
- Evidence record: `.lane/reports/0509-lane1-deploy-drift-evidence.md` (only file in the PR)
- Lane claims published to `/home/nish/workspaces/agent-state/lanes/0509/lane-1.json`

## Rollback

N/A — evidence-only change.
