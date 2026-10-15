# 2026-10-15: weekly briefs sent unfinished, with duplicate and contradicting lines

## What customers saw

The brief for the week of 5 Oct (sent 12 Oct) said "We haven't finished reviewing this week's changes yet." twice, listed every brand as "unranked", said "Your site looks broken" above three identical "breakage on <page>, fixed" lines, and showed "36 mentions · 7 site changes" with nothing behind the counts. 9 of the 12 weekly briefs sent since 2026-09-24 (9 workspaces) went out unjudged. All recipients were Nish or test accounts.

## Root cause

- The rollover wrote and emailed the brief even when the week was unjudged (`readThisFirst.unjudged`), so a half-finished week reached the inbox. The 2026-10-05 fix made judging more likely to finish but left the send unconditional.
- Why the 10-12 week was unjudged is not proven. The rollover ran once with no retries and `read-this-first` returned `unjudged: true` at 02:30:03Z; 10 competitor `mention_is_about_brand` verdicts landed only after 19:00Z that day, and no `jev_failure` row exists for that hour (`ci/weekly-brief-log-answers.md`).
- The nightly catch-up reused one Workflow id per week, and Workflows ignore a reused id, so a week was retried once at most.
- The own-site block listed every incident in the window, one line per incident, and said "broken" if any existed, even when all were closed. It printed the internal kind "breakage".
- Unjudged briefs repeated the headline in "Read this first", used the headline as the email subject, and printed "unranked" per brand. A quiet week printed counts under "Quiet week". The brief preview ranked brands from all-zero scores.

- Judging lags the freeze by design: HN and YouTube mentions get their verdict 24 hours after they are seen (the next night's mentions sweep, 12 judgments per watch per run, about 250 items left over each night), and the rollover re-judged changes but not mentions. 5 of the 6 real digests since 09-24 other than the 10-12 ones had verdicts that landed after period end (`ci/weekly-brief-log-answers-2.md`).
- `judgeWeek` swallowed every Jev error, including a spend-off refusal that writes no `jev_failure` row, and logged nothing. The 10-12 week of the bluorng.com workspace had all 33 signals judged before the freeze yet was still marked unjudged; the cause there is not provable from what was kept.

## Fix

- `weekSendable` (`app/lib/customer-ready.ts`): the rollover holds an unjudged week, writes no digest and sends nothing, for up to 72 hours. The nightly catch-up gets a new instance id each night. After the hold it sends an honest brief with no rank words.
- Before freezing, the rollover judges the closing week's unjudged mentions (up to 60 per workspace) the same way it re-judges changes (`rejudgeWindowMentions`), and `judgeWeek` logs `standing.read_this_first_unavailable` with the reason when Jev refuses.
- One own-site line per page, in plain words with when we saw it and when we re-checked (`app/lib/own-site-lines.ts`, used by the page and the email). A fixed page reads "Your site looks fine now."
- Email subject for an unjudged week is "Your weekly brief". The quiet-week line says what was checked and that none of it needed attention. The digest row stores the subject that was sent. Marks say "Captured <time>".
- The preview ranks nobody when every score is zero.

## What stops a repeat

`tests/unit/brief-real-shape.test.ts` renders a payload shaped like the 10-12 brief through the page and the email; `tests/integration/standing/rollover.integration.test.ts` proves the hold, the late send and the nightly retry id; `tests/customer-ready.test.ts` pins the rule.
