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

## Same pattern: YouTube on 2026-10-10

`youtube.channel_rss` answered 429 at 19:00Z on 2026-10-10, the night with no YouTube snapshots. The same code path skipped the whole target with no retry, so that night's channels were not read. The retry rounds above cover it (a skipped YouTube target is retried like any other); the 429 itself is Google's and is not preventable from here.

## Second night: the fix did not hold (2026-10-14, Sentry FIVE-TO-NINE-1D)

`mentions.sustained_skips` fired for `gdelt.doc`: 42 of 42 targets skipped at 19:27Z, after the breaker and retry rounds above had been deployed (09:31 to 09:38Z the same day). The alert did its job. The fix did not.

### What the evidence says

- The 19:00Z run logged 12 `mentions.rate_limited` lines, all status 429, the first at 19:01:58, and no other status, no timeout and no text-instead-of-JSON answer.
- A probe from the server the next hour: 13 requests, no two overlapping, 15 to 26 s apart, after 16 minutes of rest. 6 answered 200 and 7 answered 429, alternating with no pattern by brand or by `timespan` (1 day was no faster than 7 days; 9 to 20 s each). The first request after the rest was already a 429. The 429 body is GDELT's plain text asking for one request every 5 seconds.
- On 10-13 the first 4 targets passed and then 35 in a row were refused.

So the refusal is neither our pacing (21 s apart still gets 429) nor query cost (1 day is as slow as 7 days). It is GDELT's limit on shared load: any single request has roughly an even chance of being refused, more at 19:00Z.

### Root cause

The first postmortem treated 429 as a ban to back away from. A random refusal needs the opposite answer: ask the same question again after a pause. The breaker made it worse. With about half of requests refused, three refusals in a row happen within a few targets, so the breaker tripped, deferred every remaining target, and the retry rounds tripped it again after three each. 42 targets never got more than a handful of real attempts each.

### The fix

`fetchUpstream` takes `rateLimitRetries` and `rateLimitPauseMs`. For `gdelt.doc` a 429 is asked again up to 5 more times, 8 s apart (GDELT's own message asks for at least 5 s), inside the same target. A target is only skipped when 6 asks in a row were refused, which at an even chance is about 1 in 64, and the breaker now means what it should: three targets in a row that were refused six times each. A 403 or 202 is still not retried.

### What stops a repeat

1. Code: `tests/mentions/gdelt.test.ts` pins the 5 s minimum gap, the 6 asks and that a 403 is not retried; `tests/integration/mentions/blocked.integration.test.ts` cases B and F pin 6 asks per target and the single `mentions.rate_limited` line.
2. Alert: unchanged, `mentions.sustained_skips` still goes to Sentry.
3. Open: the next nightly `mentions.sweep` line. Expect `skipped` near 0 for gdelt and a longer run (42 targets at about 15 s plus pauses, 20 to 40 minutes). If skips remain high, the next step is the shared-load assumption: spread the 42 targets across the day.
