# 2026-10-13 — Sweep-failure alerts reached nobody

Blameless. Status: fix in code, one secret left to set.

## What customers saw

Nothing directly. The risk was silent: a sweep that did not run or failed would
not have told anyone, so a customer's brief could go stale before we noticed.

## Start and end

Start: when the cron monitors were first declared (about 11 of them).
End: when `HEALTHCHECKS_PING_KEY` is set on the Worker (see Fix).

## What happened

- Sentry showed every cron monitor except `liveness-ping` as disabled, with
  old schedules (mentions `0 1`, site `0 2`, hiring `30 2`, feed `45 2`), and
  no alert workflow was attached to any of them.
- The code sends the current schedule with every check-in
  (`SWEEP_MONITORS` in `app/lib/cadence.ts`, `cronMonitor` in
  `workers/cron-monitors.ts`), so a stale schedule means check-ins were
  dropped, not that the code was wrong.

## Root cause

Proven: the monitors are disabled and nothing is attached to alert.

Not proven: why they are disabled. Leading cause is the free Sentry plan's
monitor limit (about one) against the ~11 we declare, so extras are disabled
and their check-ins ignored. Four read-only Sentry GETs in
`/mnt/project-files/ci/journeys-sentry-asks.md` settle it.

Either way, the design was wrong: the only path to a human was a Sentry
setting nobody had made, and nothing in code could tell us it was missing.

## Detection

Found by the scheduled-run alerting audit on 2026-10-13, not by an alert.

## Fix

Each sweep workflow and the nightly cron now also ping Healthchecks.io
(`app/lib/healthcheck.server.ts`): start, ok or fail, per sweep slug. The check
is created on first ping, the free tier covers 20 checks, and it emails on a
missed or failed run. Sentry check-ins stay as they are. With no
`HEALTHCHECKS_PING_KEY` set, the ping does nothing, so deploys stay safe.

## What stops a repeat

- Tests pin the ping URL shape, one start and one ok per run, fail but never ok
  on a throw, and no second start when a workflow replays.
- Remaining gap: the secret itself. Until it is set the pings are off.
