# 2026-10-05: sign-up showed no rival suggestions

## What customers saw

After adding a first brand, the rivals screen said it found no obvious competitors yet and listed none. Reloading the page showed the suggestions.

## Start and end (UTC)

One occurrence seen, 2026-10-05 03:31 (J7 test sign-up for gymshark.com). Other sign-ups at 03:37 were fine. Open until the fix deploys.

## Root cause

The rivals screen read two things at the same moment: the discovery workflow status and the list of suggestions. When the last suggestions were still being saved, the list could be read just before they landed while the status came back "complete". The screen then stopped checking and showed the empty notice.

Evidence from run 37261871784 (same Workflow, same code, three sign-ups):

- The failing sign-up's workflow finished normally: 11 of 11 writes, last write ended 03:31:21.795, workflow ended 03:31:21.979. Nothing failed.
- The page's last check was answered at 03:31:23.55 with state "done" and an empty list. The request began up to 3 s earlier (the page checks every 3 s), so it overlapped the last writes at 03:31:21.0 to 03:31:21.8.
- The two later sign-ups (03:37:40 and 03:38:01) had the same steps and showed suggestions.
- D1 read replication is not enabled, so a lagging replica is ruled out.

Not proven: the exact request start time, since the server log gives only when the answer arrived. The test in the fix reproduces the race and fails on the old order.

## How it was detected

The J7 live journey failed on its first attempt; no customer alert exists for an empty rivals screen.

## The fix

The loader reads the status first and the lists second (`readOnboardingScreen`). If the status says complete, every write already committed, so the lists that follow are complete.

## What stops a repeat

An integration test (`onboarding-screen.integration.test.ts`) simulates the last writes landing between the reads. It fails with the old parallel order and passes with the new one.
