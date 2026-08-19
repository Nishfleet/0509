# De-flake tests/d1-remote-restore-evidence.test.ts kill-ESRCH timing race — already resolved

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane2-d1-restore-kill-esrch-already-resolved`
Base: `origin/main` at `b21cc135` (#643)

## Item

- [ ] De-flake tests/d1-remote-restore-evidence.test.ts kill-ESRCH timing race
  — main CI red on 2026-08-13T05:53Z (run 3)

## Verdict

No code change was warranted. The item is already landed on `origin/main` as a
single merged fix, an ancestor of the current `main` HEAD (`b21cc135`):

- **PR #703** — `07481600` "fix(tests): de-flake d1-remote-restore cancel spec
  by /proc identity", merged 2026-08-14T02:10: the exact race this item names.

## The failing run and the exact race

The item cites CI run 3 of the `codex-node-checks` job on main:
[run 31671869414](https://github.com/nish3451/0509/actions/runs/31671869414),
failed 2026-08-13T05:53:22Z on commit `4d49658e` (#690). The single failing
test was `tests/d1-remote-restore-evidence.test.ts > D1 remote restore evidence
automation > forwards cancellation to a detached provider child before
exiting`:

```
AssertionError: expected [Function] to not throw an error but 'Error: kill ESRCH' was thrown
  ❯ tests/d1-remote-restore-evidence.test.ts:133:51
      131|       helperProcess.kill("SIGTERM");
      132|       await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      133|       expect(() => process.kill(childPid, 0)).not.toThrow();
```

The 50 ms post-SIGTERM liveness check used `process.kill(childPid, 0)`. That
call races the child's exit-and-reap window: it throws ESRCH the moment the
child is reaped, and it also reports a dead-but-unreaped zombie (state `Z`) as
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

- `tests/d1-remote-restore-evidence.test.ts` (current main, `b21cc135`):
  - `pidAlive()` (lines 91-98) reads `/proc/<pid>/stat` fields 22 (start time)
    and 3 (state) and returns alive only when both exist and the state is not
    `Z`.
  - `killOwnedProcessGroup()` (lines 116-132) refuses to signal the group
    unless a live member of the original PGID still exists, so the finally
    block can never hit a reused PID.
  - The spec's liveness assertions (lines 215, 219, 222) all use `pidAlive`,
    and the helper's `finally` (lines 223-227) uses `killOwnedProcessGroup`.
  - No `process.kill(pid, 0)` call remains anywhere in the file.
- `tests/deploy-window-lock.test.ts` uses the same `/proc`-identity pattern
  (the choice #703 explicitly mirrors).

## Verification run (this lane)

Run on current main in this worktree (no product changes; evidence branch only):

```
$ npx vitest run --configLoader runner tests/d1-remote-restore-evidence.test.ts
 Test Files  1 passed (1)
      Tests  31 passed (31)

10 consecutive runs of the file: all passed (run 1..10, each 31/31).
```

The failing spec itself, "forwards cancellation to a detached provider child
before exiting", passed in every run.

## Files

- `.lane/reports/0509-lane2-d1-restore-kill-esrch-already-resolved.md` — this
  evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
