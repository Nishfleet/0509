# claim/issue-2734 — weekly brief catch-up for a lost in-window tick

## Diagnosis (from issue + landed code)

#2406/#2733 moved the weekly brief onto the 3-hourly monitoring tick: a
workspace's digest job is enqueued only while its local time sits inside
Monday 05:00-08:00. Window width equals tick spacing, so exactly one tick
per local Monday opens the gate — that is the exactly-once guarantee, and
also the fragility: if Cloudflare delays or drops that one tick (or the
candidates read fails closed at it), the workspace misses the whole week.
A job that is never enqueued is invisible to the pending-job recovery
sweep.

## Fix (the issue's catch-up shape, keyed on the workspace's local week)

`resolveWeeklyDigestCatchUpWindow(instant, timezone)` — null unless the
workspace's local time is Monday >= 08:00; then returns the one 3-hourly
tick that sat inside its closed window plus its local ISO-week UTC bounds.

`planWeeklyDigestCatchUpEnqueues` runs that resolver over the same
candidates read the window gate already pays for, then drops every
workspace that already has a weekly job filed inside its ISO week (new
`listDigestScheduleJobPeriodEnds` read, fail-closed like the candidates
read). Survivors enqueue under the MISSED tick's own period tuple, so the
UNIQUE (user_id, cadence, period_start, period_end) key also dedupes any
workspace a late-delivered on-time event did reach. Catch-up stays inside
local Monday only — widening past Monday is the accept-the-miss edge the
issue leaves intact.

No migration, no new cron — the catch-up rides the existing 3-hourly tick
the week of the miss.

## Files

- `app/lib/digest-orchestration.server.ts` — resolver + planner + call-site
  wiring in `runDigestDeliveryCycleDetailed`
- `app/lib/data/digests.server.ts` — `listDigestScheduleJobPeriodEnds`
- `app/lib/data.server.ts` — barrel re-export
- `workers/schedule.ts` — comment update
- `tests/weekly-digest-window.test.ts` — harness tables + 5 catch-up tests

## Verification

- `npx vitest run --project node tests/weekly-digest-window.test.ts` —
  11/11 pass (window math, ISO-week bounds, dedupe read, end-to-end cycle
  at a post-window tick, exactly-once re-run)
- `npx vitest run --configLoader runner --project node --changed
  origin/main` — 387 files / 4711 tests pass
- `semgrep --config p/default --baseline-commit <merge-base>` — clean
