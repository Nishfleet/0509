# Lane evidence — claim/issue-3422 (Nishfleet/0509#3422)

Unit: `pi-issue-0509-3422` · 2026-09-13/14 UTC · two runs: the first run closed PR #1589
then died before close-out (heartbeat released the claim at 23:49:39Z, "no live worker, no
open PR"); this re-entry (claim 23:55:14Z) verified the end state live and shipped the
record.

## Disposition — issue accept-1, path B (close-with-evidence)

- **PR #1589 CLOSED** (2026-09-13T23:36Z, close comment `5657080190`): superseded by
  **#1579** (merged 2026-09-11, merge commit `5708741e8`), which bumped
  `@simplewebauthn/server` **13.3.1 → 13.3.3**. Not closed for age.
- **Delta rule (#2868 accept-3) re-verified this run** from the API patch of #1589
  (`gh api repos/Nishfleet/0509/pulls/1589/files`): exactly 2 files
  (package.json + package-lock.json), package.json diff = exactly 12 direct bumps
  (5 deps + 7 devDeps), no overrides edits. The 12 are filed as **#3444** (fresh
  dependency pass, open). The 13th item — the @simplewebauthn lock movement the PR was
  opened for — is already on main via #1579, so re-landing the stale 3-month lock diff
  would only regress it. Nothing carried, nothing lost.
- `@dependabot recreate` was queued (comment `5656903292`); dependabot rejected it
  ("Sorry, only users with push access can use that command", `5656903617`), so the
  manual close is the deterministic disposition. If recreate processes later it no-ops
  on a closed PR.
- **Lane:** #2970's CI-audit half (npm audit in CI) stays in #2970 — stated in the close
  comment. #2868's five stale-PR numbers unaffected; #3381/#3351 are different surfaces.

## Verification (this run, worktree git == origin/main `ce9fe5517`)

- `npm ls @simplewebauthn/server --json` → **13.3.3** via `@better-auth/passkey@1.7.0`
  (13.3.1 no longer resolves anywhere in the tree).
- The issue's jq assertion → `true`
  (`.dependencies | to_entries | all(.value.version != "13.3.1")`).
- `gh pr view 1589 --json state --jq .state` → `CLOSED` (≠ OPEN).
- `npx vitest run --configLoader runner --project node tests/lane-evidence-collision.test.ts`
  → 1 file / 2 tests passed (this record is lane-unique).

## Notes

- The issue's verify line `cd /home/nish/workspaces/products/0509`; at verify time that
  clone was another lane's active checkout (`claim/issue-3412`, dirty design PNGs). It was
  left untouched; the same assertion was proven on this worktree, whose git head equals
  origin/main exactly. The lock did not change in the 13 commits between the first run's
  clean install (`65776e216`) and current main, so the installed tree is faithful.
- Diff of this PR = this lane record only: no code, no migrations, no D1, no gate-owned
  paths, no test changes (accept-2/3 honored; accept-4 stated above).
- Rollback (per issue): revert the two dependency files to pre-merge versions; #2970
  remains open as the backstop either way. Not needed — nothing regressed.
