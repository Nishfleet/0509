# J11 and J12 production journeys failed on 2026-10-14

## What customers saw

Adding a competitor held the page for several seconds before the new row appeared. No customer reported it; the production journeys caught it.

## Start and end (UTC)

Seen 2026-10-14 14:55Z (e2e-scheduled run 38584837490). Not re-run since: the j11 and j12 jobs were skipped on the two scheduled runs after it.

## Root cause

Two separate causes.

- **J11 (add timed out).** The add action awaited `tryFirstLook`, which calls `planSiteSweep` for every workspace, then keeps one workspace's rows. Each add therefore did the whole fleet's sweep planning inside the request. Proof: the j11 account's new row was written at 14:57:11Z, and the spec gave up at 14:57:16Z, five seconds later, without seeing it. Sentry shows no refused add and no plan-limit event, so the add landed and the response was late. The server-side time of the call itself was not measured.
- **J12 (11 competitors against a limit of 4).** Not a product fault. The test account's own site is gymshark.com, so the daily rollover correctly added seven sportswear competitors (2026-10-14 03:00Z) on a Starter plan that allows 15, 10 of them on. The spec's limit of 4 assumed nothing is ever added automatically.

## How it was detected

e2e-scheduled, job j12.

## The fix

The first look is queued with `waitUntil`, so an add returns when the row is written. The J12 limit is the Starter limit of 15, the most a Starter account can hold.

## What stops a repeat

The J11 spec waits for the new row to appear and fails on the 5-second timeout, so a slow add is red again if it returns. No new lint rule: the mistake was a design choice, not a pattern a rule can name.
