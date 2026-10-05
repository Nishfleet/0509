# 2026-10-05: weekly briefs went out unjudged, with no ranks

## What customers saw

The Monday brief said "We haven't finished reviewing this week's changes yet." and showed no ranking. Every weekly brief sent so far has been like this. Both briefs sent on 2026-10-05 went to test workspaces ('e2e+soak' and 'e2e+j7'), not paying customers.

## Start and end (UTC)

Start: the first weekly rollover, week 2026-09-28T02:30Z, with briefs sent 2026-10-05T02:30:07Z and 02:30:12Z. Change signals have been filed without a verdict since 2026-10-02. Open until the fix in #7065 deploys.

## Root cause

A week only freezes its ranks when every change and mention signal in it has a verdict. Nothing ever went back to judge a change signal that missed its verdict, so one miss blocked the whole workspace for the week. Three things produced misses and nothing cleared them:

- Jev answered "2003 Rate limited" and the sweep filed the signal anyway, without a verdict. Mentions are judged again on the next sweep (#6078); change signals had no such step.
- A brand that already used its 6 judgments for the day got its later changes filed without a verdict.
- A self change judged "not clear" for breakage kept only the `own_site_breakage` verdict. The freeze count looked for `noteworthy_change`, so that signal counted as unjudged forever.

Evidence (read-only D1 and run output):

- Both digests for period end 2026-10-05T02:30Z have `is_unjudged` = 1, `headline_rank` null and `standing` null.
- All 8 standing rows for week 2026-09-28T02:30Z have `rank` null.
- 30 of 35 change signals had no `noteworthy_change` verdict: 25 with no verdict at all, 5 self changes with only `own_site_breakage`.
- `jev_failure` held 54 rate-limited rows on 10-04 and 113 on 10-05 (106 `page_role` calls in the 02h hour). The `mentions-sweep-2026-10-05` run reported 56 of 137 stored mentions unjudged.
- `freezeWeek` returns an empty list while unjudged inputs exist and does not throw, so Workflow step retries never ran.

Not proven: why the 02h hour sent 106 `page_role` calls at once; that is tracked in #6922 and is not changed here.

## How it was detected

A second-pass audit of production data (#7065). No alert fired: the freeze path degrades quietly by design, and the rate-limit failures stopped reaching Sentry after 2026-10-04T03:34Z.

## The fix

#7065 (this change; supersedes #7098).

- The weekly rollover re-judges the unjudged change signals of the closing week in its own Workflow step, before it freezes ranks. Rate-limited Jev answers make that step retry. Any other error stops the rollover instead of being swallowed.
- The site sweep re-judges unjudged changes of the last 8 days.
- Re-judging reads the stored page text, never an empty page. If a stored snapshot is missing the signal is left unjudged and `site.rejudge_snapshot_missing` is logged.
- A self change whose `own_site_breakage` verdict is stored counts as judged. A self change with no stored page text is not counted, since it can never be judged.
- Re-judging and first judging share one atomic per-brand per-day cap of 6 judgments, held in the `BROWSER_BUDGET` Durable Object, so sweeps, rollovers and parallel runs cannot add up to more than 6.
- Refreshing scores is a separate step from re-judging, so a scores failure does not repeat paid Jev calls.

## What stops a repeat

- Code: the integration tests `rejudge-changes.integration.test.ts` (a deferred change blocks the freeze, then freezes after Jev recovers) and `judge.integration.test.ts` (concurrent re-judges and judgments cannot exceed the cap; a missing snapshot leaves the row unjudged). They fail on the old behaviour.
- Code: the freeze count and the re-judge query share one definition of "has stored evidence", so they cannot drift apart.
- Still open: a week with a signal whose snapshot is gone from R2 stays unjudged and its ranks still wait. Visible alerting for that, and for rate-limit bursts, is tracked in #6922.
