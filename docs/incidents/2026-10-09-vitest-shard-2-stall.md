# 2026-10-09: vitest-shard (2) stalled for 25 minutes and ejected a merge-queue run

## What customers saw

Nothing. Merge-queue run 37944369561 (the #7236 branch) was cancelled at the 25 minute job limit, so the PR was ejected and re-queued. The same head passed on its pull request run and on the re-queued merge_group run.

## Start and end (UTC)

- 2026-10-09 14:28:55: the Test step of `vitest-shard (2)` starts running files.
- 2026-10-09 14:32:45: last file finishes (`tests/integration/discovery/start-twice.integration.test.ts`, 1 test, 17 ms). Nothing is logged after it.
- 2026-10-09 14:53:13: the job is cancelled at the 25 minute limit.
- Ends when the fix PR for this postmortem merges.

## Root cause

Not yet proven. What is known:

1. Only shard 2 stalled. Shards 1, 3 and 4 of the same run finished. Shard 2 is the workers project (workerd) files, run with `vitest run --project '!node' --shard 2/4`.
2. No test failed and no error was printed. A failing assertion does not hang the workers pool: a probe test with a deliberately failing spy assertion failed in seconds.
3. The stall is not in the 2026-10-09 daily-cap change. Cancelled 25 minute `vitest-shard` jobs also exist on runs from 2026-10-06 and 2026-10-08 (including a merge_group run for #7283) on other heads, and the stalled head passed when re-run unchanged.
4. Files finish about every 10 seconds in the minutes before the stall, so the stall is a file that started and never reported, not a slow suite.

The log cannot say which file was in flight. Four things are missing:

- vitest's default reporter prints a file only when it finishes, never when it starts, so the hung file has no line.
- The Actions log API returns only the tail of a job, and the agent-access test floods that tail with stderr.
- The step has no per-file or per-run time limit shorter than the job's 25 minutes, so nothing kills the hung worker and prints it.
- vitest's `verbose` and `hanging-process` reporters do not help either: `verbose` also prints a test only when it finishes, and `hanging-process` reports only after a run ends, which a stalled run never does (checked against the vitest 4.1 reporter docs). Per-test, hook and teardown timeouts already apply (30 s test, 10 s hook and teardown by default), so the stall is outside them, most likely a file that never finished loading or its worker.

The next stall needs a different answer. "Flake" is not the cause; the cause is unknown because the evidence is not collected.

## How it was detected

`ci-ok` failed on the merge_group run with `vitest-shard (2)` cancelled.

## The fix

`vitest-shard` job `timeout-minutes` goes from 25 to 12. A healthy shard runs in about five minutes including install, so a stall now fails in 12 minutes instead of 25 and the queue frees sooner. `tests/file-start-reporter.ts` is added to the reporters in `vitest.config.ts` and prints `[file-start] <project> <file>` as each file starts, using vitest's own `onTestModuleStart` hook. This does not stop the stall; it shortens its cost and names the file next time.

## What stops a repeat

1. Code and config (this fix, partial): the shorter limit and the start lines. When the next shard stalls, the last `[file-start]` line with no matching finished line is the hung file; add its name and cause here. Still open: why that file stalls.
2. Not covered: a run that stalls before any file finishes.
