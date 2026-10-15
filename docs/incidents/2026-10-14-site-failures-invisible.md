# Failed site checks and archive reads could not be read in Sentry (2026-10-14)

## What customers saw

Nothing. No customer-facing change.

## Start and end (UTC)

Always, until this change.

## Root cause

`site.check_failed` and `archive.read_failed` were `console.log`. Sentry's console hook ships only warn and error, so a page that failed to read, or a public-archive fallback that failed, never reached Sentry. The server read on 2026-10-14 showed zero of both, which looked like health and proved nothing. The failure reason was always kept in D1 (`sweep_run.reason`), so no data was lost; only the log view was blind.

## How it was detected

LOGS' 14-day Sentry read on 2026-10-14: zero of both events while 13 pages sat deferred.

## The fix

Both already logged as `console.warn` (`app/lib/site/sweep.server.ts`, `app/lib/fetch/archive.server.ts`); this change adds the redaction. The check-failed line carries a page id, the reason and the detail with any URL replaced by `<url>` and capped at 300 characters, so no tracked-brand address reaches Sentry.

## What stops a repeat

`tests/integration/site/sweep.integration.test.ts` asserts the failed-check line is a warn. Any new event someone needs to read from the server must be a warn or an error (same rule as `site.change_discarded`, 2026-10-14).
