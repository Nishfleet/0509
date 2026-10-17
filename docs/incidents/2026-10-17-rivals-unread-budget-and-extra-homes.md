# 2026-10-17: three rivals still silent after #7686, and extra home pages

## What happened

After #7686 the 03:00Z nightly still raised `site.rivals_silent` for 3 rivals: 2 with "deferred: browser budget refused escalation (thin-text)" and 1 with "escalation-failed". All three are e2e test workspaces (`ws_e2e-kept-*`) watching one blocked site (the browser answers 422), so no customer was affected. Evidence: `ci/journeys-round3-answers.md`.

## Causes

1. **A refusal hid the real cause.** A blocked rival spends its brand allowance (4 browser reads a day) in one sweep: three alternate-home tries, then the home page. The sweep then rechecks every failed page, the fifth read is refused, and the refusal overwrote `escalation-failed` with "budget refused" at the same stamp. The step output kept the real cause; D1 and the nightly did not.
2. **Alternate-home tries share the brand allowance.** That is why the fifth read is refused. I left it alone: giving them their own allowance would raise a blocked brand's ceiling from 4 to 7 browser reads a day, and the data shows no real customer starved, so that needs Nish's yes with the cost and is not part of this change.
3. **Several `home` rows per rival.** The page-role judge gave `home` to `/homepage`, `/now`, `/intl/en-gb/` and similar. 13 rivals have more than one. Queries that join on `role = 'home'` (classification, own-site check, first look) see each row.
4. **Not fixed here:** test workspaces count as paid, so they spend browser allowance and raise this alert. They are data, not code.

## Fix

- A budget refusal no longer replaces a real failure reason stamped in the same sweep (`recordPageFailure`).
- `browser.escalation_refused` (warn, workspace id only) is now logged on every refusal, so the next read can see who is refused. It is a Sentry warn event; it fires once per refused read, which only blocked brands reach.
- The `home` role is kept for one page per rival in the judge's writer (`upsertJudgedPages`); `insertPages` stores the real home first and is unchanged, so a changed homepage url is never demoted; migration 0071 demotes the strays already stored, keeping the page the sweep watches, else the one the judge never touched, else the site root. Migrations run before the Worker deploys (`deploy-production.yml`), so the order is safe.

Tests: `failure-cause-kept.integration.test.ts`, `one-home-page.integration.test.ts`.
