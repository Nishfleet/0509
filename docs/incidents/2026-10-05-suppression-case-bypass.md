# 2026-10-05: An unsubscribe could be bypassed by changing the capitals of the address

## What customers saw

Nobody reported receiving mail after unsubscribing. The risk was this: someone unsubscribes from the weekly brief, and later a workspace owner saves that same address as the delivery address with different capitals (`Gone@Example.com` instead of `gone@example.com`). The save went through with no "this address unsubscribed" warning, and once the address was confirmed, briefs, change alerts and incident emails could go to a person who had asked to stop them.

Impact: **unknown.** Whether any production row was affected needs a read-only check run from CI (see "Evidence still needed" below). This postmortem was written without querying production.

## Start and end (UTC)

Start: not looked up. The exact-case lookup is in `email_suppression` code from the 2026-09-20 rebuild, and the bypass opened when owners could change the delivery address (0509#4779). Found: 2026-10-05, from a code report. End: when the fix PR deploys.

## Root cause

Every check against `email_suppression` compared the address exactly, and nothing normalized the address before it was stored.

- `isAddressSuppressed` and `clearSuppression` in `app/lib/data/email_suppression.server.ts` used `WHERE address = ?`.
- The send lane (`workers/delivery/consumer.ts`) had its own copy of the same exact-case query, run before every brief, change alert and incident email.
- `saveDeliveryAddress` (`app/lib/delivery-address.server.ts`) only trimmed the address, so a different-case spelling was stored as a different string in `send_target.target_value`.
- The "is this the signed-in address" check (`address === signInEmail`) was exact-case too. That check decides whether resuming clears the suppression at once and whether the address is trusted without a confirmation email.

Evidence: `tests/integration/suppression-case.integration.test.ts` and the `(c-case)` test in `tests/integration/send-lane.integration.test.ts` were written first and failed on `main` at 7576c7b. Six of the seven checks failed: the address with different capitals was not refused, a stored mixed-case suppression was not found, the target and the suppression were stored unnormalized, a resume on the signed-in address left the suppression in place, and the send lane delivered to a target whose suppression had different capitals.

Sign-in email casing is not a separate cause. better-auth 1.7.5 lowercases `user.email` when it creates or updates a user (`internal-adapter.mjs`), so new accounts store lowercase. The fix still compares normalized values on both sides, so a mixed-case row from before that, or one written by a fixture, cannot cause a wrongful refusal or a missed clear.

### Evidence still needed

A read-only query, run from CI and not by hand, that counts:

- `email_suppression` rows where `address <> lower(trim(address))`;
- email `send_target` rows where `target_value <> lower(trim(target_value))`;
- `send_attempt` rows sent to a target whose address matches a suppression row with `lower(trim())` but not exactly, and when they were sent.

The last count is the impact. Until it is run, impact stays unknown.

## How it was detected

Code reading, not an alert or a customer. No monitor compares sends against suppressions.

## The fix

The PR that adds this file:

- `app/lib/email-address.ts` adds `normalizeEmailAddress` (trim plus lowercase).
- `send_target` (`app/lib/data/send_target.server.ts`) stores the email target normalized when an owner changes it or a workspace is created, and compares `lower(trim())` on both sides when deciding whether the address changed.
- `email_suppression` (`app/lib/data/email_suppression.server.ts`) stores `lower(trim(target_value))` on unsubscribe and on workspace deletion, and compares `lower(trim())` on both sides on every read and on clearing. Old mixed-case rows are matched where they are, so no migration is needed and no row is changed or deleted.
- The send lane no longer has its own suppression query. It calls `isAddressSuppressed`, so there is one suppression reader.
- Both signed-in-address checks compare normalized values.

## What stops a repeat

1. **Codebase.** There is now one suppression read path, and both writers normalize. The send lane cannot drift from the settings page because it uses the same function.
2. **Static analysis.** Not yet done. Follow-up: a `no-restricted-syntax` rule that flags the string `email_suppression` in any file other than `app/lib/data/email_suppression.server.ts`, so a second exact-case reader cannot be added again.
3. **Tests.** The tests named under Root cause stay in the integration project and run on every PR.
