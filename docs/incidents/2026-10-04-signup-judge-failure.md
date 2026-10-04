# 2026-10-04: sign-up failed at the brand check

## What customers saw

"We couldn't check that just now. Please try again in a minute." when adding a first brand.

## Start and end (UTC)

2026-10-04 03:33 to 03:41. A fresh sign-up worked again at 03:41.

## Root cause

Strongly supported, not read from the error line itself: the account-wide Clef call rate (error 2003) was exceeded by another test job.

- The brand screen asks Clef one question with no retry. Clef answers `2003: Rate limited` when the account's call rate (about 60 a minute) is exceeded.
- Three live-AI eval runs from the rivals work (all `evals.yml`, branch `claude/rival-recall-gxqeau`) used the same account that morning, so the call rate was shared with sign-ups:
  1. Run 37174038201, 03:25:29Z to about 03:26:11Z, judge calls on. It died on `2003: Rate limited` after about 25 s.
  2. Run 37174111275, about 03:27:30Z to 03:34:53Z, three arms in parallel at concurrency 2 each, proposer and judge, about 200 or more calls. It ended with `2003: Rate limited` on all three tests. Most likely contributor.
  3. Run 37174520282, 03:36:08Z to 03:56:09Z, about 550 proposer-only calls with the arms run one after another. It overlaps the tail of the 03:33 to 03:41Z window.
- Both failed sign-ups (CX run 37174382802 at 03:33:38Z and 03:33:45Z, PAY GAPS run 37174428554 at about 03:34Z) fall inside run 2's window, and sign-ups passed again at 03:41Z while run 3 was still going. Run 3 made no judge calls, so how much it added to the rate is not proven.
- An earlier eval run (2026-10-03 18:12Z) had already shown Clef answering 2003 at eight concurrent calls.

Ruled out: a code change (no deploy between the failing and passing runs), billing (that path raises a different error and Sentry issue), answer-shape errors (would not fail within 1 s on every call), a Cloudflare incident (status page clean).

Gap: the error text of the two failed sign-ups was not read, because no credential Claude has can read the Worker logs or Sentry. #6927 closes that gap.

## How it was detected

Live customer-flow checks on production (CX and PAY GAPS runs). No alert fired: nothing watches sign-up failures, so the first sign was a test run failing.

## The fix

#6923 asks the AI Gateway to retry the brand check up to 3 times with backoff. The gateway cannot tell a billing refusal from another failure, so a billing refusal is retried too, but a refused call costs $0 and the tries are capped at 3. Whether the gateway retries a 2003 is not proven; the failure table will show it on the next one. #6927 records the exact reason of every judge failure.

## What stops a repeat

- The reason is recorded in a table CI can read, so the next failure explains itself (#6927).
- Live test jobs stop competing with customers for the shared call rate: one live-AI job at a time (#6930). A third queued run replaces the second.
- Raise the AI Gateway rate limit and run eval probes through the separate "evals" gateway.
