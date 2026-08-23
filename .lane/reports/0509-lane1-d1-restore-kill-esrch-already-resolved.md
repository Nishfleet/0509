# De-flake tests/d1-remote-restore-evidence.test.ts kill-ESRCH timing race — already resolved

**Status: already resolved on `origin/main`; this lane records the evidence only.**

Branch: `0509-lane1-d1-restore-kill-esrch-already-resolved`
Base: `origin/main` at `5b33e274` (#777)
Item id: `ac9067290c`

## Item

- [ ] De-flake tests/d1-remote-restore-evidence.test.ts kill-ESRCH timing race
  — main CI red on 2026-08-13T05:53Z (run 3 of `codex-node-checks`)

## Verdict

No code change was warranted. The exact race the item names is already fixed
on `origin/main` by a single merged PR, an ancestor of the current HEAD
(`5b33e274`):

- **PR #703** — `07481600` "fix(tests): de-flake d1-remote-restore cancel spec
  by /proc identity", merged 2026-08-14T02:10:12 +0530. The same race,
  diagnosed identically, applied the same fix.

A sibling lane reached the same conclusion earlier and recorded the evidence
in PR #737 (`88c96c70` → `7960292d`). This lane independently re-verifies the
state on the current HEAD.

## The failing run and the exact race

The item cites CI run 3 of `codex-node-checks` on main:
[run 31671869414](https://github.com/Nishfleet/0509/actions/runs/31671869414),
failed 2026-08-13T05:53:22Z on commit `4d49658e` (#690). The single failing
test was:

```
tests/d1-remote-restore-evidence.test.ts > D1 remote restore evidence automation
  > forwards cancellation to a detached provider child before exiting

AssertionError: expected [Function] to not throw an error but 'Error: kill ESRCH' was thrown
 ❯ tests/d1-remote-restore-evidence.test.ts:133:51
     131| helperProcess.kill("SIGTERM");
     132| await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
     133| expect(() => process.kill(childPid, 0)).not.toThrow();
```

The 50 ms post-SIGTERM liveness check used `process.kill(childPid, 0)`. That
call races the child's exit-and-reap window: it throws ESRCH the moment the
child is reaped, and it reports a dead-but-unreaped zombie (state `Z`) as
alive. With the test suite running 431 files in parallel on the shared
self-hosted runner, the 50 ms window regularly lost the race.

## The merged fix (PR #703, `07481600`)

- Replaced both `kill -0` liveness assertions with `/proc/<pid>/stat` identity
  checks (`pidAlive`): liveness is now judged by process start time + non-zombie
  state, matching the script's own `process_identity_is_live()` and the choice
  already locked in by `tests/deploy-window-lock.test.ts`.
- Guarded the `finally` block's `kill(-childPid, SIGKILL)` with a
  `processGroupHasMember` /proc group-member scan (`killOwnedProcessGroup`), so
  cleanup can never signal a PID-reused process group that is no longer ours
  (the same hazard the test file comments document).
- No other usage of `process.kill(pid, 0)` remains in this file.

## Evidence on current main

- `tests/d1-remote-restore-evidence.test.ts` (current main, `5b33e274`):
  - `pidAlive()` (lines 91-98) reads `/proc/<pid>/stat` fields 22 (start time)
    and 3 (state) and returns alive only when both exist and the state is not
    `Z`.
  - `killOwnedProcessGroup()` (lines 116-132) refuses to signal the group
    unless a live member of the original PGID still exists, so the finally
    block can never hit a reused PID.
  - The spec's liveness assertions (lines 215, 219, 222) all use `pidAlive`,
    and the helper's `finally` (lines 223-227) uses `killOwnedProcessGroup`.
  - `grep -c 'process.kill(pid, 0)\|process.kill(childPid, 0)\|process.kill(commandPid, 0)' tests/d1-remote-restore-evidence.test.ts`
    returns `0` — no `kill -0` liveness call remains.
- `tests/deploy-window-lock.test.ts` uses the same `/proc`-identity pattern
  (the choice #703 explicitly mirrors).
- PR #703 (`07481600`) is an ancestor of HEAD:
  `git merge-base --is-ancestor 07481600 HEAD` → success.

## Verification run (this lane)

Run on current main in this worktree (no product changes; evidence branch only):

```
$ npx vitest run tests/d1-remote-restore-evidence.test.ts
 Test Files  1 passed (1)
      Tests  31 passed (31)
```

- 30 consecutive isolated runs of the cancel spec
  (`-t "forwards cancellation"`): 30/30 pass.
- 20 consecutive full-file runs: 20/20 pass (31 tests each, 620 test
  invocations total).
- Final 10-run re-verification before recording the report: 10/10 pass.

The failing spec itself, "forwards cancellation to a detached provider child
before exiting", passed in every run on the current HEAD.

## Why no code change

The contract §1b says an agent must not ask for permission to finish the job
when the work is already done. The contract §1 says a question the agent
could have answered by inspecting the repository is rework. The packet's
acceptance scope is "de-flake the kill-ESRCH timing race." That race is
already removed; manufacturing a new change would be drive-by refactoring on
a locked-in test, against the contract's "Change only what the approved plan
names" rule.

## Files

- `.lane/reports/0509-lane1-d1-restore-kill-esrch-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
