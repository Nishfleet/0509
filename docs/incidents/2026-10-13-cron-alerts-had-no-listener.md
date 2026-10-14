# 2026-10-13 — Sweep-failure alerts reached nobody

Blameless. Status: fix in code, one secret left to set.

## What customers saw

Nothing directly. The risk was silent: a sweep that did not run or failed would
not have told anyone, so a customer's brief could go stale before we noticed.

## Start and end

Start: 2026-10-05. The last Sentry check-ins were mentions-sweep 10-05T01:01Z
and site-sweep 10-05T02:02Z; neither monitor reported again.
End: when `HEALTHCHECKS_PING_KEY` is set on the Worker (see Fix).

## What happened

- Read-only Sentry reads on 2026-10-13: mentions-sweep and site-sweep are
  DISABLED, still scheduled `0 1` and `0 2`; only `liveness-ping` is active.
  No alert workflow is attached to any monitor.
- The code sends the current schedule with every check-in
  (`SWEEP_MONITORS` in `app/lib/cadence.ts`, `cronMonitor` in
  `workers/cron-monitors.ts`), so the stale schedules mean check-ins stopped
  being accepted, not that the code was wrong.
- Over 14 days Sentry accepted 9133 check-ins and rate-limited 484. The
  monitor-seat stat came back empty and the plan endpoint returned 404, so the
  quota is unknown.

## Root cause

Proven: Sentry disabled the sweep monitors on or after 10-05, and nothing was
attached to alert on a missed or failed run, so the sweeps went unwatched from
10-05 to now.

Not proven: why Sentry disabled them. Likely the free plan's monitor limit
against the ~11 we declare; the plan page is the one thing only Nish can read.

Either way the design was wrong: the only path to a human was a Sentry setting
nobody had made, and nothing in code could show it was missing.

## Detection

Found by the scheduled-run alerting audit on 2026-10-13, not by an alert.

## Fix

Each sweep workflow and the nightly cron now also ping Healthchecks.io
(`app/lib/healthcheck.server.ts`): ok or fail, per sweep slug. The check
is created on first ping, the free tier covers 20 checks, and it emails on a
missed or failed run. Sentry check-ins stay as they are. With no
`HEALTHCHECKS_PING_KEY` set, the ping does nothing, so deploys stay safe.

## What stops a repeat

- Tests pin the ping URL shape, one ok per run, fail but never ok
  on a throw, and no ping before the sweep ends. There is no start ping: Healthchecks
  would apply its 1-hour grace to a sweep that may run up to 120 minutes.
- Remaining gap: the secret itself. Until it is set the pings are off.
