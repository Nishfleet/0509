# 2026-10-03: runaway AI spend and broken onboarding

## What customers saw

Sign-up onboarding could not finish: the brand check and rival discovery failed.

## Start and end (UTC)

Broken from 2026-10-02 23:41 to 2026-10-03 17:34. The spend freeze was lifted at 17:41.

## Root cause

AI calls ran without a budget, so the account ran into its limits.

- The eval suite ran about 30 times with no cap.
- The nightly job re-ran Discovery for every workspace, including about 27 test accounts, with 3 retries each.

Evidence: the run history of the eval and nightly jobs, and the billing refusals that onboarding hit during the window. The 2026-10-04 sign-up failure is a separate incident.

## How it was detected

The failing onboarding was found by CX and journey runs, and the spend overrun was noticed by Nish. No alert fired for either: there was no budget alert on AI spend. Cloudflare budget alerts (Nish's list, item 4) and #6908 cover this gap.

## The fix

#6787, #6790, #6812, #6793, #6794 and #6791 (the Clef switch). Later hardening: #6918 to #6921.

## What stops a repeat

- Any job that costs money gets its own budget, a hard cap and an alert before it ships.
- Billing errors are never retried.
- Test accounts are skipped by scheduled jobs.
