# 2026-10-11: a breakage judged after the sweep never alerted

## What customers saw

Possibly nothing: J8 soft (#7337) saw no "looks broken" email after the 21:00Z sweep on 2026-10-10. Whether this gap caused that miss is not yet proven.

## Start and end (UTC)

The gap existed from the day site sweeps started judging own-site changes through `rejudgeUnjudgedChanges`. It ends with the commit that adds `openLateBreakage`.

## Root cause

Not yet proven for 2026-10-10. Proven in code: when the breakage judgment for an own-site change was deferred or failed during the sweep (Jev unavailable, rate limited, per-brand daily budget), `publishSiteChange` filed a plain change signal and sent nothing. The end-of-sweep `rejudgeUnjudgedChanges` later got a real `alert` or `check` verdict for that signal and only linked the verdict rows. It never opened the incident or sent the email, so a real break judged late never alerted. The prod rows that would show whether this happened on 10-10 (`signal` aspect, `jev_verdict`, `incident`) are queued for a session with Cloudflare access.

## How it was detected

J8 soft in the scheduled production suite waited past the sweep and found no email.

## The fix

`rejudgeStoredChange` calls `openLateBreakage` when an own-site change gets an `alert` or `check` band. It marks the signal `breakage`, opens the incident and its alert, and emails only for `alert`, exactly as the sweep path does. The `check` band opens the in-app alert without an email, as before. A break older than 48 hours is not announced. If the page already has an open incident, nothing new is sent.

## What stops a repeat

1. Code: `openLateBreakage` and its tests in `tests/integration/site/late-breakage.integration.test.ts` (Jev down at the sweep then answering, check band, clear, open incident, stale).
