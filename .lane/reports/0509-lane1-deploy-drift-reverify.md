# Lane 1 — deploy remote_main_drift item: fresh re-verification that it stays fixed on main

**Item**: Stop Deploy production from dying on remote_main_drift after a full green gate when main moves mid-run [scout 2026]

**Verdict**: Already implemented and merged on `origin/main` (commits `c3539abb` / PR #556 and `f5aabf14` / PR #630). Re-verified on 2026-08-17 against the current `origin/main` SHA `6d4fcd2d`. Evidence-only change; no product code touched.

## Why the fix is still in place

The two-line drift downgrade lives in `scripts/ci-verify-provider-main-cas.sh`:

```bash
elif [[ "${TOLERATE_MAIN_DRIFT:-0}" == "1" ]]; then
  # Post-gate drift tolerance: the caller (Deploy production, after its full
  # verification gate) deploys exactly PINNED_SHA, so a mid-run move of main
  # does not change what ships. Record the move and continue with the verified
  # SHA instead of failing the whole run. Every other failure above stays
  # fail-closed even with this flag set; drift is the only downgrade.
  printf 'Deploying pinned SHA %s behind main: provider main moved to %s while the exact candidate was verified.\n' \
    "$PINNED_SHA" "$remote_sha" >&2
else
  fail "remote_main_drift"
fi
```

The `TOLERATE_MAIN_DRIFT=1` env flag is set on every post-pin CAS step in `.github/workflows/deploy-production.yml`:

| Job / step | Line | File |
| --- | --- | --- |
| `prepare_remote_restore_evidence` / "Verify pinned candidate before self-hosted work" | 143 | `.github/workflows/deploy-production.yml` |
| `generate_restore_evidence` / "Reconfirm frozen main before evidence mutation" | 260 | `.github/workflows/deploy-production.yml` |
| `deploy` / "Verify pinned candidate before repository and secret work" | 440 | `.github/workflows/deploy-production.yml` |
| `deploy` / "Reconfirm frozen main before provider mutation" | 535 | `.github/workflows/deploy-production.yml` |
| `deploy-production-plan.mjs` / `reconfirm_frozen_main_before_deploy` step | 294 | `scripts/deploy-production-plan.mjs` |

The `pin_candidate` initial pin remains fail-closed on drift (no `TOLERATE_MAIN_DRIFT` flag on its `ci-verify-production-candidate.sh` invocation). Every other CAS failure (repository mismatch, ref mismatch, malformed SHA, head mismatch, checkout not detached, API unavailable) stays fail-closed even when the flag is set.

## Verification commands run on 2026-08-17

```bash
$ git rev-parse origin/main
6d4fcd2de25a00a6dc967b97b26570116a8f049c

$ git merge-base --is-ancestor c3539abb origin/main && echo PR556_ancestor=YES
PR556_ancestor=YES

$ git merge-base --is-ancestor f5aabf14 origin/main && echo PR630_ancestor=YES
PR630_ancestor=YES

$ git merge-base --is-ancestor f5cd7b5a origin/main && echo PR726_ancestor=YES
PR726_ancestor=YES

$ node ./node_modules/vitest/vitest.mjs run \
    tests/production-candidate-workflow.test.ts \
    tests/deploy-production-gate.test.ts
 Test Files  2 passed (2)
      Tests  47 passed (47)
```

The 47 tests pin the drift-tolerant behavior — the original PRs (#556 and #630) added the assertions that the post-pin steps set `TOLERATE_MAIN_DRIFT: "1"` and the CAS script downgrades only the `remote_main_drift` branch while keeping every other failure fail-closed.

## Deliberately unchanged

- `d1-remote-restore-evidence.yml`'s three "Reconfirm frozen main" steps and `d1-backup-r2.yml` stay fail-closed on drift. These are unattended nightly D1 mutation drills; proceeding on a moved main is unsafe. `tests/d1-remote-restore-evidence.test.ts` pins their env exactly (`{ GH_TOKEN }`, no drift flag).
- `pin_candidate` initial pin stays fail-closed on drift — the deploy must verify the exact SHA before any sub-job or step trusts it.

## Differentiator vs. previous lane evidence

- Verified against the current `origin/main` SHA `6d4fcd2d` (not the SHA at the time of PR #726).
- Re-ran the focused 47-test suite locally and confirmed all-green on this branch.
- Cross-checked that the four post-pin step locations plus the plan step still carry `TOLERATE_MAIN_DRIFT: "1"`.
- Confirmed that no later commit on `main` has added a new post-pin CAS step that forgot the flag (the only workflow changes touching drift since #630 are the unattended `d1-remote-restore-evidence.yml` / `d1-backup-r2.yml` drills, which deliberately stay fail-closed).

## Deliverables

- Branch `0509-lane1-deploy-drift-reverify` created from `origin/main` (fresh, no product code changes).
- Evidence record: `.lane/reports/0509-lane1-deploy-drift-reverify.md` (only file in the PR).
- Lane claims published to `/home/nish/workspaces/agent-state/lanes/0509/lane-1.json`.

## Rollback

N/A — evidence-only change.
