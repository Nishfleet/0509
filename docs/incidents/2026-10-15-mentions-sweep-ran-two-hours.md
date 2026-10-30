# The mentions sweep ran for two hours and was still going (2026-10-15)

## What customers saw

Mentions from other sources arrived late. The 19:00Z sweep normally ends by 19:30Z; on 15 October it was still running at 20:57Z, nearly two hours. GDELT news mentions were stored for about half the targets it reached.

## Start and end (UTC)

Started 2026-10-15 19:00Z. The cause was in the code from 2026-10-15 01:06Z (#7579, which made GDELT retry a 429) until this change.

## Root cause

GDELT answered most requests slowly and many with 429. Each GDELT step then waited and asked again up to five more times at a fixed 8 seconds, and a step that still ended in a 429 was retried by the Workflow (three attempts) and again by up to three retry rounds with pauses of 2, 4 and 8 minutes. LOGS' read of 29 GDELT steps: median 102 s, longest 723 s, 18 over 60 s, 20 rate-limit lines. Nothing in the sweep had a time limit, so a slow source could hold the whole run for as long as its retries lasted. The source-tripping rule (three skipped targets in a row) did not fire; successes between the 429s fit that, but the per-step order is not read in full. Not yet proven: why GDELT itself answered slowly (it is slow even when it does not return a 429, 1.5 to 2 minutes a step against 14 seconds on 14 October); the run's final line was still to come when this was written.

## How it was detected

LOGS' 20:57Z read, relayed by the coordinator. The 10-14 run was 26.5 minutes.

## The fix

The sweep carries a time budget (`workers/mentions/budget.ts`): 45 minutes for the whole run and 15 minutes for any one source, counted from the time each step took plus the pace and retry pauses, so a replayed Workflow reaches the same decisions. A target past its budget is not started; it is counted as skipped and logged once per source as `mentions.targets_skipped` with the reason (`run_budget` or `source_budget`), and the run ends normally. The final `mentions.sweep` line carries a `deferred` count. Retry rounds skip any source or run that is out of budget. A rate-limited GDELT request now waits 8 s, then 16 s (two more asks, not five), so one target costs at most about 30 seconds of waiting plus its own request time.

The 15-minute per-source limit was removed by #7685: it cut the news source at 42 of its 61 brand targets, and the run budget alone bounds the run. #7685 also reads the plan round-robin across sources and records a source the run could not finish as degraded.

## What stops a repeat

`tests/mentions/budget.test.ts` and `tests/integration/mentions/retry.integration.test.ts` pin the budgets and that retries stop when one is spent; `tests/mentions/gdelt.test.ts` pins the doubling wait and the three asks. A sweep that overruns now shows as `mentions.targets_skipped` lines instead of a run that never ends. FIVE-TO-NINE-1D (`mentions.sustained_skips`) stays the alert that a source is mostly skipped.
