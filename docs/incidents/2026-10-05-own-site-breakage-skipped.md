# 2026-10-05: a broken own site was never judged, so no alert

## What customers saw

Nothing was sent. When a customer's own site broke in a way the hourly check cannot see (the page loads with a 200 but its content is gone), the nightly sweep saw the change and filed it as an ordinary home-page change. No "looks broken" email went out and no incident opened. Found by the J8 soft journey, which waited 90 minutes for the email (run 37248804764, failed 2026-10-05 02:17Z).

## Start and end (UTC)

Start: 2026-09-26 (#5606 added the per-brand daily judgment budget). End: when the fix PR (#6997) is deployed; the deploy time is added here once known. Proven on one night, 2026-10-05; the same condition held on 2026-10-04.

## Root cause

`judgeChange` returned before asking the own-site breakage question whenever the brand had used its daily budget of 6 verdicts. The budget counted every verdict row of the brand's entity, including the mention verdicts the hourly mentions sweep writes for the same entity. The soak report shows the J8 soft brand held 12 `mention_is_about_brand` and 5 `mention_matters` verdicts decided at 01:00:59Z on 2026-10-05, 17 against a budget of 6, before the 02:04:35Z sweep read the broken page. The sweep then filed a change with aspect `home` (the path a deferred judgment takes) and wrote no `own_site_breakage` verdict, no incident and no send attempt. The page itself was served broken: the snapshot hash changed from the healthy page to the broken one with zero words added.

Why 2026-10-02 05:04Z worked: the verdict rows have no insert time, but their SQLite rowids do. The 05:04:01Z `own_site_breakage` verdict has rowid 742; the 15 mention verdicts stamped 05:01:05Z have rowids 884 to 898. The mentions sweep stamps every verdict with the time the sweep started and writes them minutes later, so at 05:04Z the brand had used none of its budget. On 2026-10-05 the mentions sweep had finished writing at about 01:01Z, so the budget was spent hours before the 02:04Z sweep. The cap logic was consistent; the stamped time hid the write order.

## How it was detected

The J8 soft journey, by the missing email. No alert fired on the product itself, since a deferred judgment logs nothing.

## The fix

Each kind of judgment now has its own hard daily allowance per brand, counted by question: own-site breakage (6) and noteworthy-change (6). Mention verdicts count against neither. The own-site breakage question is asked before the change allowance is checked, and its verdict row is always stored, even when the page is clear and the change judgment is deferred, so every breakage call is counted and cached. A site over its breakage allowance defers without calling Jev. `countVerdictsSince` takes the question ids to count.

Tests: cases f3 to f6 in `tests/integration/site/judge.integration.test.ts` (mentions never defer a competitor change or an own-site breakage check, the breakage verdict is kept, breakage calls are bounded per site per day) and a sweep test in `tests/integration/site/sweep.integration.test.ts` that opens the incident and queues the email with 17 mention verdicts already stored.

## What stops a repeat

1. Code: the tests above.
2. Not done yet: the mentions sweep has no daily allowance of its own; it is bounded only by the feed sizes. A hard per-brand cap there needs a change under `workers/`.
3. Not done yet: a deferred own-site judgment should be visible (a log line, or a retry on the next sweep).
