# Lane evidence — de-flake deploy-window-lock post-death kill -0 probes

- Item: `05d31dc650`
- Branch: `fix/deflake-deploy-window-lock-kill-0-probes`
- Commit: `d4fc32b8bbcb63b3d355b6a71ea7457616f00482`
- Base: `origin/main` at `34c72deeb4a340b4412b9bebb3a8972add1720fb`

## What changed

Deleted the two post-death `expect(() => process.kill(commandPid, 0)).toThrow();`
assertions in `tests/deploy-window-lock.test.ts`:

- spec `"forwards cancellation and reaps the lock-holding command group"`
- spec `"bounds cancellation of a TERM-ignoring command and immediately reuses its slot"`

The preceding `waitFor(... && !pidAlive(commandPid))` already proved death via
`/proc` identity (`pidAlive`). A later `kill -0` can false-fail on PID reuse or
an unreaped zombie. Positive pre-cancellation probes and the D1-provider
`.toThrow()` at the former line 837 were left untouched.

Product diff: 1 file, 2 deletions, 0 insertions.

## Acceptance

1. `npx vitest run tests/deploy-window-lock.test.ts --retry 3` → exit 0,
   `Test Files  1 passed (1)`, 25 tests, not skipped (13.02s).
2. Five consecutive targeted runs: each exit 0, `Test Files  1 passed (1)`,
   `RUN ... FAILED` never printed.
3. `npm test` on Node 22.23.1 (`/usr/local/bin/node`, repo pin `.node-version`
   22.22.0) → exit 0, `Test Files  463 passed (463)`, `Tests  5504 passed (5504)`.
   Cursor's bundled Node 24.5.0 fails unrelated sqlite `?1` suites; that is
   environment, not this diff.
4. `npm run typecheck` → exit 0.
5. `git diff --stat` of the product commit: `tests/deploy-window-lock.test.ts | 2 --`
   with exactly two removed lines matching
   `-      expect(() => process.kill(commandPid, 0)).toThrow();`
