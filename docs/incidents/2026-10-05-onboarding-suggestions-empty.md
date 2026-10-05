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

#7048.

The loader reads the status first and the lists second (`readOnboardingScreen`). The workflow only reports "complete" after its last write step has committed, so a reader that sees "complete" and then reads the lists can never see partial results, whatever the timing.

Why not one read: the status lives in Cloudflare Workflows and the lists live in D1, so no single query or batch can cover both. A "finished" marker saved in D1 would be a second source of truth for the same fact and needs a migration; the happens-before order gives the same guarantee without one.

## What stops a repeat

- The primary guard is the code order itself: status first, lists second, with every list write inside an awaited workflow step. It rests on two assumptions: Workflows reports "complete" only after `run()` resolves, and D1 read replication stays off. Turning replication on would need the reads moved onto one D1 session.
- When the screen reads "complete" with an empty list, the loader logs `discovery.done_with_empty_list` with the time the status was read and the time the lists were read. Compared with the instance's write-step times (`wrangler workflows instances describe competitor-discovery <id> --json`, which CI can already read), the next occurrence, if any, proves itself. The event also fires when the result is legitimately empty, so an entry is a lead to compare, not proof of a repeat.

An integration test (`onboarding-screen.integration.test.ts`) simulates the last writes landing between the reads. It fails with the old parallel order and passes with the new one.
