# Lane evidence: claim/issue-6475

Issue: Nishfleet/fleet-ops#6475 — "Nine 0509 CI jobs run under GitHub's
360-min default: no job-level timeout" (research-delta). Prescribed classes:
30m scan/test, 120m wait/authorize_release, 300m deploy-production
authorize_release/pin_candidate.

## What shipped (2026-09-20)

The filing's 9 unbounded jobs no longer all exist. Git history:

- `e7e517aa6` "cut(ci): resolve 12 disabled workflows" (Sep 20) — deleted
  `review-gate.yml` (carried `classify`).
- `b9e241e1f` "deploy: stock pipeline — verify, migrate, wrangler deploy,
  smoke, rollback (design A of #3679)" (Sep 20) — deleted
  `d1-backup-r2.yml`, `d1-backup-validate.yml`,
  `d1-remote-restore-evidence.yml`, `d1-restore-proof-auto-refresh.yml`,
  `finalize-production-soak.yml` and rewrote `deploy-production.yml`
  (776→~90 lines); the rewrite removed the old `authorize_release` /
  `pin_candidate` jobs; the new `verify` and `deploy` jobs are already
  bounded (30m/45m).

Survivors with no `timeout-minutes` at work start: exactly two, both
class (a):

- `.github/workflows/secret-scan.yml` → `gitleaks`
- `.github/workflows/backlog-console-refresh-test.yml` → `test-refresh`

Diff is one `timeout-minutes: 30` line per job. Note the
`secret-scan/gitleaks` edit adds the ceiling to a required branch-protection
check and touches nothing structural: no `if:`, no `needs`, the fork-guard
stays a step — the workflow's comment block forbidding skippability is
preserved intact.

## Verification

- PyYAML audit over all 12 workflow files / 20 jobs: every job carries
  `timeout-minutes` (5,10,25,30,45,60,270 — the 120/300 classes have zero
  survivors after `b9e241e1f`/`e7e517aa6`).
- actionlint on both changed files: exit 0; whole-tree actionlint delta
  vs origin/main: empty (findings in `ci.yml` etc. are pre-existing and
  unchanged by this branch — stale local actionlint binary map).
- semgrep `--config p/default --baseline-commit <merge-base> --quiet
  --metrics=off`: exit 0.

## Run-proof: a hung step dies at its ceiling, not at 360

Scratch branch `scratch/hang-drill-6475` (deleted after evidence; file diff
reproduced in the PR body) carried `.github/workflows/hang-drill.yml`:
`on: push`, one job `hung-step` with `timeout-minutes: 2` and `sleep 600`.

Run https://github.com/Nishfleet/0509/actions/runs/35483662427
(head a87a4424b, repo clock 2026-09-20):

- workflow created 02:18:53Z, completed 02:21:10Z — elapsed ≈ 2m17s total
  (the 360-min default would have been unreachable headroom by ~357 min).
- hang step started 02:18:56Z, killed 02:21:08Z — ≈ 2m12s start-to-kill
  on a 2-minute ceiling (ceiling + settle granularity).
- runner-level signature:
  `##[error]The operation was canceled.` (current-action runner's
  job-timeout message; the older literal
  `exceeded the maximum execution time of N minutes` was retired), then the
  runner's own "Cleaning up orphan processes / Terminate orphan process:
  pid (1940) (sleep)".
- conclusion `cancelled` — the runner canceled the job itself at the
  ceiling; no human or bot was watching this branch. Job-level evidence,
  not the 360 default.

The drill proves the mechanism the diffs rely on: a job-level
`timeout-minutes` value kills a hung step at its ceiling. It does not
directly re-run the two 30m diffs (30 minutes of idle runner for no new
information); the mechanism is value-independent, so 2 minutes suffices.

## Adjudicated review findings (Jev p=0.19 senior round, then worker fix)

- Act on — run-proof hang-drill missing from body → shipped, above.
- Act on — commit-message attribution credited all 7 dead jobs to
  `e7e517aa6`; actually only `review-gate/classify` died there, the other
  6 with `b9e241e1f` → corrected in the amended commit message and PR body.
- Act on — missing lane report → this file.
- Noted — required gitleaks check now fail-closed RED on an infra-slow
  push-to-main instead of hanging; merge-queue runs are range-scoped.
- Consider — no regression test enumerating `jobs.*.timeout-minutes`;
  follow-up issue filed separately (fleet-ops scope guard).

## Fleet-ops claim branch note

fleet-ops `claim/issue-6475` (de367cd) holds only reset-to-main commits —
no salvageable work; all real diffs land in Nishfleet/0509.
