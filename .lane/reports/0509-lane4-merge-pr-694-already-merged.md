# Lane 4 evidence: merge PR #694 — already merged to origin/main

Item: "Merge PR #694 — the required-check merge gate is satisfied by SKIPPED
contexts: both Gitleaks and codex-node-check"

This lane records resolution evidence; no product code change was warranted.

## Resolution

The item is already merged to origin/main:

- PR #694 — "fix(ci): required contexts structurally incapable of skipping
  (Gitleaks, codex-node-checks)", merged **2026-08-13** by `nish3451` as
  merge commit `35e3dd3c` (`fix(ci): required contexts structurally incapable
  of skipping (Gitleaks, codex-node-checks) (#694)`).
- `35e3dd3c` is an ancestor of `origin/main` HEAD `422fbd55` (verified with
  `git merge-base --is-ancestor` on 2026-08-21).

## What the merged code does

- `.github/workflows/ci.yml` and `.github/workflows/secret-scan.yml` — the
  required contexts `codex-node-checks` (CI) and Gitleaks (secret-scan) no
  longer have a job-level `if:` or `needs:`, so they are structurally
  incapable of concluding SKIPPED. The standalone `authorize_release` job's
  authorization was folded into each required job as its first step
  (`id: authorize`); checkout and verify steps now use
  `steps.authorize.outputs.sha`.
- `d1-backup-r2.yml`, `d1-remote-restore-evidence.yml`, and
  `deploy-production.yml` keep their standalone `authorize_release` jobs
  (their consuming jobs are not required contexts).
- Regression coverage: `tests/required-context-no-skip.test.ts` (3 tests) and
  the updated `tests/production-candidate-workflow.test.ts` entrypoint
  guards; focused workflow sweep 11 files / 99 tests pass.

## Live verification (2026-08-21)

- `gh pr view 694` → `state: MERGED`, `mergedAt: 2026-08-13T01:57:10Z`,
  `mergeCommit: 35e3dd3c889c25deb101778661f8f86fcc3c3239`.
- `git merge-base --is-ancestor 35e3dd3c origin/main` → ancestor.
- `origin/main:.github/workflows/ci.yml` carries the post-fix shape: no
  job-level `if:` / `needs` on the required job, authorizer as step 1.
- `origin/main:.github/workflows/secret-scan.yml` carries the same folded
  shape with `steps.authorize.outputs.sha`.

## Files touched by this lane

- `.lane/reports/0509-lane4-merge-pr-694-already-merged.md` — this evidence
  record.

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
