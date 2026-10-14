# Discarded site changes could not be read anywhere (2026-10-14)

## What customers saw

Nothing. No customer-facing change.

## Start and end (UTC)

Always, until this change.

## Root cause

`site.change_discarded` was a `console.log`. Sentry's console hook ships only warn and error, so Sentry showed zero lines for 7 days, and the Workers Logs API refuses the CI token (403), so nobody could tell whether the event fired at all. Whether it fired is not yet proven; it is now a `console.warn` so the next sweep's lines reach Sentry.

## How it was detected

The server logs read on 2026-10-14 showed zero lines in Sentry.

## The fix

`console.warn` in `app/lib/site/sweep.server.ts`. The line holds a page id and a kind only.

## What stops a repeat

Open: Workers Logs stays unreadable from CI until the token gets Workers Observability read. Until then, anything we need to read from the server must be a warn or an error.
