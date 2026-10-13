# 2026-10-08: the mentions, site and hiring sweeps did not run that evening

## What customers saw

Probably nothing. Sweeps serve paid workspaces only since #7061 and #7217, and production had no plan rows then (migration 0051), so no paying workspace is known to have missed a night. If one existed, its changes and mentions for 10-08 arrived a day late.

## Start and end (UTC)

Start: 2026-10-08 19:00, the first mentions tick on the new schedule. End: 2026-10-09 19:00, when the first new-schedule slot with a fresh date ran. The soak report on 10-09 showed 0 instances for mentions, site and hiring, and gdelt, hn, hiring and linear.app stale.

## Root cause

Workflow instance ids were the sweep name plus the date (`mentions-sweep-2026-10-08`). #7258 (merged 2026-10-08 09:00:32Z) moved the crons from 01:00, 02:00, 02:30 and 02:45 to 19:00, 21:00, 23:30 and 01:00. The old schedule had already created `mentions-sweep-2026-10-08`, `site-sweep-2026-10-08` and `hiring-sweep-2026-10-08` between 01:00 and 02:30 that morning. The new ticks at 19:00, 21:00 and 23:30 asked for the same ids, and `createBatch` skips an id that already exists, so nothing started. The hourly catch-up (`startMissedDailyWorkflows`) builds the same date-only ids, so it was skipped for the same reason. 10-09 used fresh ids, which is why it cleared by itself. The VPS D1 counts agree: the 10-08 snapshots were written at 01 to 02Z and the next run was 10-09 at 19/21/23Z. A deploy gap is ruled out: the deploy went live 18:58Z.

## How it was detected

The 7-day soak report on #4730 (FAIL on the cron-instance line).

## The fix

The id now includes the hour (`mentions-sweep-2026-10-08T19`), so a moved schedule can never collide with the one it replaced. The catch-up uses the same function, so it still matches its own cron tick. `tests/workflow-crons.test.ts` pins the 10-08 case.

## What stops a repeat

1. Code: the hour in the id and its test.
2. The soak report still counts cron-started instances per sweep in the last 24 h.
