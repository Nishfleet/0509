# 2026-10-17: three rivals still silent after #7686, and extra home pages

## What happened

After #7686 the 03:00Z nightly still raised `site.rivals_silent` for 3 rivals: 2 with "deferred: browser budget refused escalation (thin-text)" and 1 with "escalation-failed". All three are e2e test workspaces (`ws_e2e-kept-*`) watching one blocked site (the browser answers 422), so no customer was affected. Evidence: `ci/journeys-round3-answers.md`.

## Causes

1. **A refusal hid the real cause.** A blocked rival spends its brand allowance (4 browser reads a day) in one sweep: three alternate-home tries, then the home page. The sweep then rechecks every failed page, the fifth read is refused, and the refusal overwrote `escalation-failed` with "budget refused" at the same stamp. The step output kept the real cause; D1 and the nightly did not.
2. **Alternate-home tries were taking the home page's allowance.** They are already capped to 3 blocked rivals per sweep and retried every 3 days, so taking brand allowance protected nothing.
3. **Several `home` rows per rival.** The page-role judge gave `home` to `/homepage`, `/now`, `/intl/en-gb/` and similar. 13 rivals have more than one. Queries that join on `role = 'home'` (classification, own-site check, first look) see each row.
4. **Not fixed here:** test workspaces count as paid, so they spend browser allowance and raise this alert. They are data, not code.

## Fix

- A budget refusal no longer replaces a real failure reason stamped in the same sweep (`recordPageFailure`).
- Alternate-home tries have their own allowance of 3 a day; the brand allowance of 4 is for its pages. No cap was raised.
- `browser.escalation_refused` (warn, workspace id and kind only) now reaches Sentry, so the next read can see who is refused.
- The judge's `home` is kept only for one page per rival (`upsertJudgedPages`); migration 0070 demotes the strays already stored to `other`, keeping the site root.

Tests: `failure-cause-kept.integration.test.ts`, `one-home-page.integration.test.ts`.
