# Rivals we could not read looked the same as rivals with nothing new (2026-10-14)

## What customers saw

A rival page that needed a real browser (bot checks, script-only pages) got no snapshot and no explanation. The Website line on the competitor page said "First read tonight" for as long as it stayed unread.

## Start and end (UTC)

Dead letters: 25 `fetch-sweep.dead_lettered` events between 2026-10-02 22:00 and 2026-10-04 22:00, none since. The silent state itself lasted until this change.

## Root cause

Three gaps, proven from the code and the server read of 2026-10-14:

1. The first-look queue lane reads pages with the browser switched off. A page that needs the browser therefore came back `deferred` ("no browser budget callback wired") even though nothing had refused it, `readPage` stamped `deferred_at`, and the classifier skips a deferred page for three days. Seven of the nine deferred home pages carried that mark.
2. The consumer treated every `deferred` result as a failure, retried it, and after the retries the message went to the dead-letter queue. A page that needs a browser cannot be fixed by retrying the same fetch, so those retries ended in dead letters. The dead-letter event carried only the queue name, so nobody could tell why.
3. No reason was stored. `page.transport_reason` is written only on a good read, so every deferred page showed NULL.

The 17 rivals reported with a home page and no watch were created on 2026-10-14 at 03:00 by the rollover in free test workspaces, which the site sweep skips by design, so that part was not an outage. A paid rival cannot stay in that state: `planSiteSweep` adds a watch for every unwatched entity each night before the paid filter.

## How it was detected

By reading the server logs and D1 on 2026-10-14. Nothing alerted.

## The fix

Migration `0062_page_last_failure.sql` and the page writer keep the reason and time of the latest failed read and clear them on the next good read. The queue lane no longer stamps `deferred_at`, and acks a `deferred` result (the nightly sweep reads it with the browser) while still retrying a timeout. The dead-letter event names the stored reason. A nightly check, `site.rivals_silent`, raises a Sentry error when a paid rival has had no snapshot for 7 days and logs the count per reason.

## What stops a repeat

1. Code: `tests/integration/site/read-page.integration.test.ts`, `fetch-sweep.integration.test.ts` and `silent-rivals.integration.test.ts`.
2. Alert: the nightly `checkSilentRivals` error.
3. Open: whether the nightly sweep's browser budget (4 pages per brand per day) is enough for the heaviest rivals is proven by the next `site.rivals_silent` line, if one appears.
