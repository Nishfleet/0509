# 2026-10-05: a broken own site was never judged, so no alert

## What customers saw

Nothing was sent. When a customer's own site broke in a way the hourly check cannot see (the page loads with a 200 but its content is gone), the nightly sweep saw the change and filed it as an ordinary home-page change. No "looks broken" email went out and no incident opened. Found by the J8 soft journey, which waited 90 minutes for the email (run 37248804764, failed 2026-10-05 02:17Z).

## Start and end (UTC)

Start: 2026-09-26 (#5606 added the per-brand daily judgment budget). End: when the PR that removes the budget check from the own-site breakage question is deployed. Proven on one night, 2026-10-05; the same condition held on 2026-10-04.

## Root cause

`judgeChange` returned before asking the own-site breakage question whenever the brand had used its daily budget of 6 verdicts. The budget counted every verdict row of the brand's entity, including the mention verdicts the hourly mentions sweep writes for the same entity. The soak report shows the J8 soft brand held 12 `mention_is_about_brand` and 5 `mention_matters` verdicts decided at 01:00:59Z on 2026-10-05, 17 against a budget of 6, before the 02:04:35Z sweep read the broken page. The sweep then filed a change with aspect `home` (the path a deferred judgment takes) and wrote no `own_site_breakage` verdict, no incident and no send attempt. The page itself was served broken: the snapshot hash changed from the healthy page to the broken one with zero words added.

Not yet proven: why the same account's breakage was judged on 2026-10-02 05:04Z with 15 mention verdicts already counted at 05:01Z. The code was the same.

## How it was detected

The J8 soft journey, by the missing email. No alert fired on the product itself, since a deferred judgment logs nothing.

## The fix

The own-site breakage question is asked before the budget is checked, so a brand that is out of budget is still checked for breakage. The budget now only limits the noteworthy-change judgments after it. Regression tests: cases f3 and f4 in `tests/integration/site/judge.integration.test.ts` (f3 fails on the old code).

## What stops a repeat

1. Code: case f3 pins that a brand with six unrelated verdicts today still gets its breakage judged.
2. Not done yet: the budget still counts mention verdicts, so competitor changes can be deferred the same way. Counting only change-judgment questions touches `app/lib/data/jev_verdict.server.ts`, which needs coordinator review, and is a separate change.
3. Not done yet: a deferred judgment on an own site should be visible (a log line or a retry on the next sweep).
