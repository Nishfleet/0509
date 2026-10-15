# 2026-10-15: a test date became the past and the merge queue went red

## What customers saw

Nothing. No customer-facing behaviour changed. Every PR in the merge queue failed `codex-node-checks` and was dequeued, so nothing merged for about an hour.

## Start and end (UTC)

2026-10-15 00:00, when the date in the test stopped being in the future, to the merge of #7582 at about 01:06.

## Root cause

`tests/unit/plan-line.test.ts` used 15 October 2026 as the end of a cancelled plan with time left. `planLine` defaulted its `now` to the real clock, so from midnight the plan read as lapsed and "says when a cancelled plan stops" failed. Evidence: the failing log line `Your paid plan ended on 15 October 2026` against the expected `You're on Agency until 15 October 2026`. With the clock set to 31 December 2026, this was the only node-project test that failed; the 213 workers-project files that finished before that run was stopped all passed.

## How it was detected

The merge queue run for #7562 failed at 00:16 UTC.

## The fix

#7582 moved the dates to 2036. The follow-up passes a fixed `now` in those tests and makes `now` a required argument in `planLine`, `takeRecipientSlot` and `readDeviceList`.

## What stops a repeat

Lint: `DEFAULT_CLOCK_PARAMETER` in `eslint.config.js` rejects a parameter that defaults to `new Date()` in `app/` and `workers/`, pinned by `tests/eslint-default-clock-rule.test.ts`. A global fake clock was tried and dropped: it breaks `@date-fns/tz` in 11 test files.

## Sweep for other tests that read the real clock (2026-10-15)

The workers project (1652 tests) was run with `Date` pushed to 20 November 2027. Twelve tests failed; eleven of them were the shifted `Date` disagreeing with workerd's own clock (Workflow ids, R2 and queue stamps), and all six files pass on the real clock. One was real: `teammates.integration.test.ts` expected two teammates added in the same millisecond in a fixed order. It now compares without order. The node project, with the same shift, failed 18 tests, all in time-zone formatting that `@date-fns/tz` breaks under any `Date` replacement, the reason a global fake clock was dropped. No other test depends on the day it runs.
