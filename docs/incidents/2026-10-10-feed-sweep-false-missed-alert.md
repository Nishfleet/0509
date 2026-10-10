# 2026-10-10: Sentry reported the feed sweep as missed while it ran

## What customers saw

Nothing. The 01:00Z feed sweep ran and finished. The only effect was a Sentry issue and GitHub issue #7318, "Missed Workflow started: feed-sweep".

## Start and end (UTC)

Instance `feed-sweep-2026-10-10` was created 01:00:59Z, started 01:01:02Z and completed 01:01:33Z. The warning was sent at 01:01Z. On 2026-10-09 the instance was created at 01:01:58Z, so the same condition was possible then.

## Root cause

Not yet proven. Known: the warning is sent only when `startMissedDailyWorkflows` in `workers/workflow-crons.ts` creates an instance, and it treated a slot as missed the moment `scheduledTime < now`, with no allowance for a tick that arrives a little after its slot. An instance created about a minute after 01:00 means the catch-up and the real `0 1 * * *` tick raced, and the catch-up won. Worker logs for that minute are not available to confirm which path ran.

## How it was detected

Sentry created #7318 from the warning. A read-only look at the Workflows API showed the instance had run normally.

## The fix

The catch-up counts a slot as missed only once it is five minutes old (`CATCH_UP_GRACE_MS`). A test pins that a slot 59 seconds old is left to its own cron tick.

## What stops a repeat

1. Code: the grace window and its test in `tests/workflow-crons.test.ts`.
2. If the warning still fires with the window in place, the cause is something other than a near-simultaneous tick, and the next step is Worker logs for that minute.
