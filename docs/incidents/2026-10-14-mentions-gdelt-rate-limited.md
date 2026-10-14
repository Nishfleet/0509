# News mentions barely ran for eleven nights (2026-10-03 to 2026-10-13)

## What customers saw

Almost no news mentions. Of about 39 gdelt targets (117 watches) a night, only 2 to 4 targets were read; the rest were skipped. Nothing on screen said so.

## Start and end (UTC)

At least 2026-10-03 (25 rate-limit lines that night), worsening to 35 on 2026-10-13. Ends when the PR for this postmortem is deployed and a sweep shows `mentions.sweep` with `skipped` near 0.

## Root cause

GDELT answers HTTP 429 to almost every request after the first few. Evidence from the server logs: on 2026-10-13 exactly 35 `mentions.rate_limited` lines between 19:01:55 and 19:13:20, steady about 17 s apart, and 4 successful targets at 19:01:07. The first requests succeed on both nights checked (10-03 and 10-13), so this is a rate limit that trips after a handful of requests, not a ban. The sweep treated 429 as "skip this target and go to the next", so it kept asking at the same pace and every later target met the same answer. The skipped targets are only recovered by the next night's `timespan=7d` query, which gets the same answer, so coverage stayed near zero rather than healing. Why GDELT starts refusing after about 4 requests (shared egress address or its per-minute budget) is not yet proven; the fix does not depend on it.

## How it was detected

By reading the server logs on 2026-10-14. Nothing alerted: a 429 was a `console.warn` only, and the sweep's summary line was `console.log`, which Sentry does not ship.

## The fix

The sweep stops hammering a source that keeps refusing: three skipped targets in a row trips that source for the pass, then up to three retry rounds follow after 2, 4 and 8 minute pauses (about 14 minutes at most). A source that is still more than half skipped, with at least three skipped, raises a Sentry error `mentions.sustained_skips`. The `mentions.sweep` summary is now a warn, so it reaches Sentry.

## What stops a repeat

1. Code: the breaker and retry rounds in `workers/mentions/retry.ts`, tested in `tests/integration/mentions/retry.integration.test.ts`.
2. Alert: `mentions.sustained_skips` goes to Sentry as an error.
3. Open: whether the pause lengths are enough in production is proven by the next nightly `mentions.sweep` line, to be read from Sentry.
