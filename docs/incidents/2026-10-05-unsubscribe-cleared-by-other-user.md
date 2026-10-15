# 2026-10-05: any signed-in user could clear another person's unsubscribe

## What customers saw

Nobody reported this. The exposure was that a person who had unsubscribed from briefs through their `/u/:token` link could have their unsubscribe removed by a different signed-in user. That user only had to save the address as their own delivery address with "resume" ticked. The address owner's own verified workspace target would then be sent briefs again, and the owner would also be sent a verification mail they never asked for. Consent withdrawn by the owner could be reversed by a third party, which is a CAN-SPAM and GDPR risk and a risk to sender reputation.

## Start and end (UTC)

Start: the behaviour was built as specified in #4779 step 3c (test 4c), so it was present from that change. The exact date it first reached production was not checked.

Found: 2026-10-05 03:12, when #6998 was opened from the pro-dev audit of `origin/main` at `6ce267ca2`.

End: 2026-10-05 08:42, when #7097 merged (PR closed 08:42:51) and #6998 closed. The production deploy time was not checked here; the exposure ended when that deploy finished.

## Root cause

`saveDeliveryAddress` cleared the global unsubscribe row for an address before anyone had proved they owned it. Evidence from #6998, at `6ce267ca2`:

- `app/lib/delivery-address.server.ts:90-93`: `if (await isAddressSuppressed(address)) { if (!input.resume) return {...SUPPRESSED}; await clearSuppression(address); }`. This ran before the verification mail was sent (line ~107).
- `app/lib/verify-delivery-address.server.ts:5-8`: `confirmDeliveryAddress` only set `is_verified`, so the confirm step never touched the unsubscribe.
- `app/lib/data/email_suppression.server.ts:3-20`: the suppression table is keyed by address alone, shared by every workspace.
- `workers/delivery/consumer.ts:174-179`: the send path checks only that table (`isSuppressed`), so deleting the row re-enabled any verified target for that address, including the owner's.
- The behaviour came from the design in #4779 step 3c, which assumed the person saving the address was its owner. A second reviewer re-read the code and confirmed it. A search of issues for the cross-user case found nothing earlier.

## How it was detected

By the pro-dev audit (#6998), not by a customer report. Whether anyone exploited it was not checked: no suppression or send history was queried for this entry, so there is no evidence either way.

## The fix

#7097, merged 2026-10-05 08:42:51 UTC, closes #6998.

- `saveDeliveryAddress` with resume ticked now clears the unsubscribe at once only when the address equals the signed-in user's own email (`refuseOrResumeSuppressed`). For any other address the row stays, the target is saved unverified and the confirmation mail goes out as before.
- The `/v/:token` confirm step now reads the address from the token (new `readEmailTargetByToken` in the `send_target` writer), clears the unsubscribe for it, then marks the target verified. Clearing runs before the token is burned and each step is safe to repeat, so a retried click finishes the job.
- The confirmation mail path (`workers/delivery/send.ts`) does not check the unsubscribe list, so the owner still receives the link. The brief consumer does check it, so nothing else reaches the address until the owner confirms.

Regression tests in `tests/integration/delivery-address-change.integration.test.ts`:

- (c) resume keeps the unsubscribe until the owner confirms, then confirm clears it and verifies the target.
- (c2) resume on the signed-in user's own address clears it at once.
- (c3) another user saving someone else's unsubscribed address with resume leaves the unsubscribe row and the owner's verified target in place.
- (c4) an expired or unknown confirm token changes nothing.

Per the PR, (c) and (c3) failed on the old code and the three affected test files passed on the fix.

Known gap, from the PR review: the signed-in-email comparison is case-sensitive, the same as the existing instant-verification check. It was left unchanged as out of scope.

## What stops a repeat

- Code: an unsubscribe is lifted only after the owner proves control of the address, either by signing in with it or by clicking the link mailed to it. Consent withdrawal is never cleared on a saved-but-unverified address.
- Tests: (c3) fails on the old behaviour, so reintroducing a clear before proof breaks CI. (c) and (c4) pin the confirm-time clear and the unchanged state on a bad token.
- Not covered by a rule: no lint rule stops a new caller of `clearSuppression` that skips the ownership check. The test covers the two current paths only.
