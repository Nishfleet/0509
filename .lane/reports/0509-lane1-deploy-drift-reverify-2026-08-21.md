# Lane 1 — deploy remote_main_drift item: fresh re-verification on 2026-08-21

**Item**: Stop Deploy production from dying on remote_main_drift after a full green gate when main moves mid-run [scout 2026]

**Verdict**: Already implemented and merged on `origin/main` (commits `c3539abb` / PR #556 and `f5aabf14` / PR #630). Re-verified on 2026-08-21 against the current `origin/main` SHA `422fbd55`. Evidence-only change; no product code touched.

## Why the fix is still in place on this SHA

The drift tolerance downgrade lives in `scripts/ci-verify-provider-main-cas.sh`:

```bash
elif [[ "${TOLERATE_MAIN_DRIFT:-0}" == "1" ]]; then
  # Post-gate drift tolerance: the caller (Deploy production, after its full
  # verification gate) deploys exactly PINNED_SHA, so a mid-run move of main
  # does not change what ships. Record the move and continue with the verified
  # SHA instead of failing the whole run. Every other failure above stays
  # fail-closed even with this flag set; drift is the only downgrade.
  printf 'Deploying pinned SHA %s behind main: provider main moved to %s while the exact candidate was verified.\n' \
    "$PINNED_SHA" "$remote_sha" >&2
```

The `TOLERATE_MAIN_DRIFT=1` env flag is set on every post-pin CAS step in `.github/workflows/deploy-production.yml` at the current SHA:

| Line | Job / step | Script |
| --- | --- | --- |
| 170 | `prepare_remote_restore_evidence` / "Verify pinned candidate before self-hosted work" | `ci-verify-production-candidate.sh` |
| 296 | `generate_restore_evidence` / "Reconfirm frozen main before evidence mutation" | `ci-verify-provider-main-cas.sh` |
| 476 | `deploy` / "Verify pinned candidate before repository and secret work" | `ci-verify-production-candidate.sh` |
| 571 | `deploy` / "Reconfirm frozen main before provider mutation" | `ci-verify-production-candidate.sh` |

Plus the in-process deploy step in `scripts/deploy-production-plan.mjs` (`reconfirm_frozen_main_before_deploy`) sets `TOLERATE_MAIN_DRIFT: "1"`.

The `pin_candidate` initial pin remains fail-closed on drift (no `TOLERATE_MAIN_DRIFT` flag on its `ci-verify-production-candidate.sh` invocation). Every other CAS failure (repository mismatch, ref mismatch, malformed SHA, head mismatch, checkout not detached, API unavailable) stays fail-closed even when the flag is set.

## Verification commands run on 2026-08-21

```bash
$ git rev-parse origin/main
422fbd5542c310b3f4d694ca7345f990865fb4e1

$ git merge-base --is-ancestor c3539abb origin/main && echo PR556_ancestor=YES
PR556_ancestor=YES

$ git merge-base --is-ancestor f5aabf14 origin/main && echo PR630_ancestor=YES
PR630_ancestor=YES

$ node ./node_modules/vitest/vitest.mjs run \
    tests/production-candidate-workflow.test.ts \
    tests/deploy-production-gate.test.ts
 Test Files  2 passed (2)
      Tests  49 passed (49)
```

49 tests pass (47 in the previous verification on 2026-08-17 + 2 added since). The pins cover: the drift-tolerant branch in `ci-verify-provider-main-cas.sh` activates only when `TOLERATE_MAIN_DRIFT: "1"` exactly; non-drift failures (malformed SHA, wrong repo/ref, checkout not detached, head mismatch, API unavailable) still fail-closed; the `pin_candidate` initial pin deliberately has no flag.

## Differentiator vs. previous lane evidence

- Verified against the current `origin/main` SHA `422fbd55` (not the SHA at the time of the prior reverify PR which was `6d4fcd2d`, and not the SHA at the time of the original evidence PR which was `abf2b3e1`).
- Re-ran the focused 49-test suite locally and confirmed all-green on this branch.
- Cross-checked the four post-pin step locations plus the plan step still carry `TOLERATE_MAIN_DRIFT: "1"`.
- Confirmed that no later commit on `main` has added a new post-pin CAS step that forgot the flag (the only workflow changes touching drift since #630 are the unattended `d1-remote-restore-evidence.yml` / `d1-backup-r2.yml` drills, which deliberately stay fail-closed).

## Deliberately unchanged

- `d1-remote-restore-evidence.yml`'s three "Reconfirm frozen main" steps and `d1-backup-r2.yml` stay fail-closed on drift. These are unattended nightly D1 mutation drills; proceeding on a moved main is unsafe. `tests/d1-remote-restore-evidence.test.ts` pins their env exactly (`{ GH_TOKEN }`, no drift flag).
- `pin_candidate` initial pin stays fail-closed on drift — the deploy must verify the exact SHA before any sub-job or step trusts it.

## Deliverables

- Branch `0509-lane1-deploy-drift-reverify-2026-08-21` created from `origin/main` (fresh, no product code changes).
- Evidence record: `.lane/reports/0509-lane1-deploy-drift-reverify-2026-08-21.md` (only file in the PR).
- Lane claims published to `/home/nish/workspaces/agent-state/lanes/0509/lane-1.json`.

## Rollback

N/A — evidence-only change.
