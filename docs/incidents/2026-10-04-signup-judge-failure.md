# 2026-10-04: sign-up failed at the brand check

## What customers saw

"We couldn't check that just now. Please try again in a minute." when adding a first brand.

## Start and end (UTC)

2026-10-04 03:33 to 03:41. A fresh sign-up worked again at 03:41.

## Root cause

Not yet proven. What is known: the judge call failed and the screen hides the reason. Candidates are a request-rate limit (2003), a billing refusal, or a transient gateway error. The failure also began before any burst of our own test traffic, so that theory does not fit.

Update this section once the first row lands in `jev_failure` (#6927) or logs prove one candidate.

## How it was detected

Live customer-flow checks on production.

## The fix

#6923 retries the brand check up to 3 times with backoff, and never on billing errors. #6927 records the exact reason of every judge failure.

## What stops a repeat

The reason is recorded in a table CI can read, so the next failure explains itself.
