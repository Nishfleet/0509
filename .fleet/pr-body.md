## What

Fixes the cancellation revoke no-op on subscription-id mismatch.

`applyDodoPlanRevokeWithWatchlistReconcile` required hard equality
`dodo_subscription_id = ?`. When the stored column is NULL (grant came from a
`payment.succeeded` payload with no subscription_id) or the extractor's
fallback supplied a bogus id, the revoke UPDATE matched 0 rows — but
`buildDodoWebhookLedgerFinalizeStatement` was pushed unconditionally in the
same batch, so the event was finalized `processed`, the route returned 200,
Dodo stopped redelivering, and a cancelled customer kept paid access with no
alert.

The ledger is now finalized from the plan state at the end of the batch:

- When the plan is `free` (the revoke matched and transitioned it, or an
  earlier terminal event already revoked) the event is finalized `processed`.
- When the plan is still paid (`plan != 'free'`) the revoke matched 0 rows, so
  the event is finalized `ignored` with a distinct
  `ignoredReason: "subscription_id_mismatch"` — the state stays visible and
  retryable instead of a silent `processed`.

The revoke UPDATE itself is unchanged (still scoped to the subscription
predicate), so multi-sub users are not at risk of revoking the wrong
subscription. Grant semantics and `extractDodoPlanGrant` are untouched.

## Verification

- `npx vitest run --configLoader runner --project node tests/dodo-billing-reversal-atomicity.test.ts` — 20 passed (2 new tests + 18 existing).
- `npx vitest run --configLoader runner --project node` — 653 files / 7782 tests passed.
- `npx vitest run --configLoader runner --project workers` — 46 files / 231 tests passed (one pre-existing flaky rate-limit test failed on the first run, passed on re-run; unrelated to this change).
- `npm run typecheck` — exit 0.

run-proof: node vitest project (653 files / 7782 tests), workers vitest project (46 files / 231 tests), typecheck (exit 0).

## Tests

- `leaves the ledger non-processed with a reason when the revoke matches no subscription id` — seeds `plan='starter'`, `dodo_subscription_id=NULL`, `dodo_customer_id='cus_1'`; calls revoke with `providerSubscriptionId 'sub_1'`; asserts plan stays `starter` and the ledger outcome is `ignored` carrying `ignoredReason: "subscription_id_mismatch"`.
- `still revokes and finalizes processed when the subscription id matches` — seeds `dodo_subscription_id='sub_1'`; calls revoke with `sub_1`; asserts plan becomes `free` and the ledger outcome is `processed`.

review: skipped, no capable seat

Closes #2258
