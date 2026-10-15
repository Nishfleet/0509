# 2026-10-09: vitest-shard (2) stalled for 25 minutes and ejected a merge-queue run

## What customers saw

Nothing. Merge-queue run 37944369561 (the #7236 branch) was cancelled at the 25 minute job limit, so the PR was ejected and re-queued. The same head passed on its pull request run and on the re-queued merge_group run.

## Start and end (UTC)

- 2026-10-09 14:28:55: the Test step of `vitest-shard (2)` starts running files.
- 2026-10-09 14:32:45: last file finishes (`tests/integration/discovery/start-twice.integration.test.ts`, 1 test, 17 ms). Nothing is logged after it.
- 2026-10-09 14:53:13: the job is cancelled at the 25 minute limit.
- More stalls: 15:43 to 15:56 and 16:13 to 16:25 on this PR's heads. Ends when the fix PR for this postmortem merges and a week of runs shows no more.

## Root cause

Not yet proven. What is known:

1. Only shard 2 stalled. Shards 1, 3 and 4 of the same run finished. Shard 2 is the workers project (workerd) files, run with `vitest run --project '!node' --shard 2/4`.
2. No test failed and no error was printed. A failing assertion does not hang the workers pool: a probe test with a deliberately failing spy assertion failed in seconds.
3. The stall is not in the 2026-10-09 daily-cap change. Cancelled 25 minute `vitest-shard` jobs also exist on runs from 2026-10-06 and 2026-10-08 (including a merge_group run for #7283) on other heads, and the stalled head passed when re-run unchanged.
4. Files finish about every 10 seconds in the minutes before the stall, so the stall is not a slow suite: the run stops after a file reports and the next one never starts.

On the first stall the log could not say which file was in flight. The `[file-start]` reporter in this PR then caught two more stalls on this PR's own heads (run 37953795021 at head 3278f79, and run 37957265286 at head 5cd88a7), both shard 2 and both cancelled at the new 12 minute limit. What they show:

- Every file that started also finished; no file hung mid-test. After the last file reported, the next file never printed a start line.
- vitest orders files by size, largest first, so the shard ends on its smallest files. The last files to finish were `tests/integration/discovery/start-twice.integration.test.ts` (first stall and second stall) and `tests/integration/identity/probe-limit.integration.test.ts` (third stall). The next files in that order are `feeds/source-config`, `health` and `web-bot-auth-directory`, then the five single-file projects (`entity-fk` x2, `e2e-inbox`, `support-inbox`, `fixture-site`, `transport`), each with its own workerd.
- A first guess, that `start-twice` leaves a Discovery Workflow running, was tested and is wrong: the third stall happened with that test changed to finish its Workflow, and the file passes locally either way.
- Not reproduced locally: the 17 discovery files and the other workers files pass on every local run.

So the stall is at the end of the shard, while vitest starts the next file or the next project's workerd, not in any test body. The reporter now also prints `[file-queued]` (vitest's `onTestModuleQueued`, which fires before the file is imported), so the next stall names the file even if it hangs while loading.

Later evidence (2026-10-10, run 38029789089): shard 2 queued, started and passed all 144 files, then never printed its summary. So the run reached its end and then hung, which points at teardown rather than any test body.

Suspect, narrowed but not proven: ten workers tests built a real better-auth captcha plugin, and `magic-link-ttl` and `sign-in-limit` posted to the magic-link path, which called the live Turnstile siteverify endpoint (`challenges.cloudflare.com`) from workerd. A live outbound call that never settles could keep a workerd alive after the files pass. Offline, `magic-link-ttl` failed, which shows it depended on that call. No run has yet shown the stall gone after the change, so the live call is not confirmed as the cause.

The change: `magic-link-ttl` and `sign-in-limit` build auth with captcha off (neither is about captcha), and `magic-link-captcha` stubs siteverify and keeps its pass, reject and missing-token cases. The reporter now prints `[run-end] N files finished`, so the next stall shows whether vitest reached the end of the run. With no network, the whole non-node suite passes (213 files, 1440 tests).

The four gaps below are why the first stall could not be read. Four things are missing:

- vitest's default reporter prints a file only when it finishes, never when it starts, so the hung file has no line.
- The Actions log API returns only the tail of a job, and the agent-access test floods that tail with stderr.
- The step has no per-file or per-run time limit shorter than the job's 25 minutes, so nothing kills the hung worker and prints it.
- vitest's `verbose` and `hanging-process` reporters do not help either: `verbose` also prints a test only when it finishes, and `hanging-process` reports only after a run ends, which a stalled run never does (checked against the vitest 4.1 reporter docs). Per-test, hook and teardown timeouts already apply (30 s test, 10 s hook and teardown by default), so the stall is outside them, most likely a file that never finished loading or its worker.

The next stall needs a different answer. "Flake" is not the cause; the cause is unknown because the evidence is not collected.

## 2026-10-11: the stall is a shutdown hang after every file passed

Merge-queue run 38112796284 (the #7330 branch, 04:49Z) had the hermetic Turnstile change and the `[run-end]` line on `main`, and `vitest-shard (2)` still stalled. Read in full (3664 lines):

- All 54 files in the shard were queued, started and printed a pass line. None failed, none was left unfinished. The last pass line is 04:55:19Z (`discovery/start-twice` and `identity/probe-limit`, the two smallest files, run as a pair).
- Then 7 minutes 15 seconds of silence until the 12 minute cap cancelled the job at 05:02:34Z. Healthy shards print vitest's `Test Files` summary and the `[run-end]` line within a second of their last pass line. This one printed neither, so vitest never reached the end of the run even though no test was still running.
- Cleanup killed exactly one `workerd`. Every healthy run leaves none. So one Miniflare was not disposed when the run stalled.
- Each workers-project file boots its own Miniflare (about 9 seconds) and the pool disposes it when the file ends (`CloudflarePoolWorker.stop()` calls `mf.dispose()`, about 1.2 seconds in the log). The last pair's dispose is where the log stops.
- The hang is not in Turnstile and not in a test body. The earlier guess that `start-twice` leaves a Workflow running is not supported either: it is the last file of every stalled shard only because files run smallest last.
- Not reproduced: a full local run of the same shard (54 files, 5 minutes, exit 0, `[run-end]` printed), 5 runs of the 17 discovery files, and 8 runs of the last pair under six busy CPU loops each all ended cleanly with no `workerd` left.

What the code says (miniflare 5.20260926.1-alpha, not proven to be the cause): `Miniflare.dispose()` first awaits `#waitForReady(true)`, which awaits the runtime mutex, and only then asks the runtime to stop `workerd`. A live `workerd` after the stall means dispose never got past that wait, or the runtime stop itself never returned.

Cause: still not proven. "Flake" is not the cause and neither is a slow runner (the same files take 5 minutes locally).

What changed: the reporter now has a watchdog. If no file is queued, started or finished for 90 seconds it prints `[stalled]` lines with the files still unfinished, what the vitest process still holds open (`process.getActiveResourcesInfo()`) and the full process tree. The next stalled shard names the process that is holding it, and that settles which `dispose` step is stuck.

## 2026-10-12: cause found and reproduced, `identity/field-edit` leaked a Miniflare

The reporter's watchdog caught the stall on run 38250151409 (job 114814384168, #7365, dump at 12:41:41Z). No test was failing. `vitest`, `esbuild` and one `workerd` were still alive.

- The surviving `workerd` was started within 0.3 seconds of `tests/integration/identity/field-edit.integration.test.ts` being queued. The 10-11 capture also had exactly one survivor.
- At the end of that file three `outputGateBroken` exceptions fired 2 ms after its pass line.
- `field-edit` calls `confirmCard` in tests that never observe the tail Workflow. The tail Workflow calls `startDiscovery`, which starts a real `DISCOVERY` instance. With Jev unavailable in tests, Discovery throws a `NonRetryableError` and the engine aborts the instance while the file is tearing down. A Workflow instance still running when the pool calls `Miniflare.dispose()` keeps the runtime mutex busy, and `dispose()` waits on it, so the pool never finishes.

Reproduced locally by running only that file 12 times, each under four busy CPU loops with a 70 second limit. A healthy run takes 41 to 46 seconds. 4 of 12 runs hit the limit, and each left one `workerd` alive. After the fix, 8 of 8 runs finished in 42 to 45 seconds with no `workerd` left. Eight clean runs is evidence, not proof: the failure rate before the fix was one in three.

Fix: `field-edit` replaces the `DISCOVERY` binding with an empty `createBatch` for each test, the same way `discovery/start-eligibility` does. The test still checks everything it did before, because it asserts on field-edit rows, not on Discovery. No test is skipped or weakened.

What stops a repeat: any test that starts the tail Workflow without observing it can leak the same way. The watchdog stays, so the next stall names the process and file. A candidate for a lint rule is a workers test that calls `confirmCard` without `introspectWorkflow(env.IDENTITY_TAIL)` or a stubbed `DISCOVERY`; not added here.

## How it was detected

`ci-ok` failed on the merge_group run with `vitest-shard (2)` cancelled.

## The fix

`vitest-shard` job `timeout-minutes` goes from 25 to 12. A healthy shard runs in about five minutes including install, so a stall now fails in 12 minutes instead of 25 and the queue frees sooner. `tests/file-start-reporter.ts` is added to the reporters in `vitest.config.ts` and prints `[file-queued]` and `[file-start] <project> <file>` for each file, using vitest's own `onTestModuleQueued` and `onTestModuleStart` hooks. This does not stop the stall; it shortens its cost and names the file next time.

## What stops a repeat

1. Code and config (this fix, partial): the shorter limit and the start lines. When the next shard stalls, the last `[file-queued]` line with no matching finished line is the hung file; add its name and cause here. Still open: why that file stalls.
2. Not covered: a run that stalls before any file finishes.
