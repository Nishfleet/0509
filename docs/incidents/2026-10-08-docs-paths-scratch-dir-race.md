# 2026-10-08: docs-paths test failed with ENOENT on a scratch directory another test owns

## What customers saw

Nothing. The failure was in CI only: `vitest-shard (1)` went red on #7276 (run 37724170248, head d0c3e0fe) in `tests/docs-paths.test.ts`, "is cited by a file that exists", with `ENOENT: no such file or directory, open '.../app/sentry-logs-probe-95eLr2/probe.ts'`. The change in #7276 does not touch either test.

## Start and end (UTC)

- 2026-10-07 20:01: #7275 merged and put `tests/docs-paths.test.ts` on `main`.
- 2026-10-08 03:51:44: the first failure, on #7276.
- Ends when the fix PR for this postmortem (#7277) merges.

## Root cause

Two test files share one mutable directory tree and neither knows about the other. `tests/observability/sentry-logs.test.ts` creates `app/sentry-logs-probe-*` with `mkdtemp` and deletes it in a `finally`, because eslint applies the `no user data in logs` rule through the `app/**` block, so the probe has to live under `app/`. `tests/docs-paths.test.ts` listed the repo with a recursive `readdirSync` walk. Vitest runs test files in parallel workers, so when the walk listed the probe directory and the delete landed before the file was read, `readFileSync` threw. Which shard pairs the two files, and how the timing falls, decides which pull request is hit: any PR can.

"Flake" is not the cause. The failure names the file and the two writers.

## How it was detected

`ci-ok` failed on #7276 and the shard log named the path.

## The fix

`tests/docs-paths.test.ts` builds its scan set from `git ls-files -z` instead of walking the directory, so an untracked scratch file is never in it, whatever another test creates. The directory and extension filters are unchanged. The probe test stays as it is: it needs `app/`.

## What stops a repeat

1. Code (this fix): the scan only reads tracked files, so a scratch path under any directory cannot be listed.
2. Not covered: another test that reads a tracked file while a different test rewrites it. None exists today; a test that must write inside the repo should use a uniquely named scratch directory, as the probe does, and a test that scans the repo should list tracked files.
