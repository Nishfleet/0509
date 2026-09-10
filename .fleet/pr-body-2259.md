## fix(billing): cancelling Dodo hosted checkout never clears checkout_pending, locking a ready-to-pay user out for 24 hours

Closes #2259

### Problem

A free user who clicks Subscribe -> `claimDodoPlanCheckout` sets `dodo_status='checkout_pending'` -> backs out on Dodo's hosted page. No payment was attempted, so no `payment.failed`/`subscription.failed` webhook ever fires (those are the only paths that call `clearDodoPlanCheckout`). The cancel loader only redirected, so the `checkout_pending` lock survived and the user was pinned out of a new checkout for 24h (`DODO_PLAN_CHECKOUT_LOCK_MINUTES = 24*60`, and the stale window is Math.max-clamped so no caller can shorten it).

### Fix

In the cancel loader (`app/routes/api.billing.dodo.cancel.ts`), after `requireSession`, resolve the billing user id and call `clearDodoPlanCheckout` for the session user before the redirect. The clear's own WHERE clause keeps it scoped to `dodo_status='checkout_pending'` on a free plan, so a genuinely active subscription is never touched. The clear targets `session.user.id` only — never a workspace owner.

### Tests

- `tests/integration/billing-checkout-cancel.integration.test.ts` (new): runs the REAL cancel loader against the REAL D1 (real migrations, no mocked binding).
  - Seeds a free user, `claimDodoPlanCheckout({userId, checkoutId:'c1'})`, invokes the cancel loader with an authenticated request, then asserts `claimDodoPlanCheckout({userId, checkoutId:'c2'})` is `true` (today it is `false`).
  - Asserts a user whose `dodo_status` is not `checkout_pending` (e.g. an active subscription) is untouched by the cancel loader.
  - Asserts the cancel clears only the session user's lock, never another user's.
- `tests/dodo-checkout.route.test.ts`: updated the two cancel-return tests to assert the loader now clears the session user's pending checkout (and never the workspace owner's).

### Verification

- `npx vitest run tests/integration/billing-checkout-cancel.integration.test.ts --configLoader runner --project workers` -> 1 file, 3 tests passed.
- `npx vitest run tests/dodo-checkout.route.test.ts --configLoader runner --project node` -> 1 file, 26 tests passed.
- `npm run typecheck` -> exit 0.

run-proof: integration test `billing-checkout-cancel.integration.test.ts` (3 tests) + route test `dodo-checkout.route.test.ts` (26 tests) + `npm run typecheck` all green on `claim/issue-2259`.

### Scope

- `must-not` honored: `DODO_PLAN_CHECKOUT_LOCK_MINUTES` unchanged; clear targets the session user only; no pricing/plan-name/copy changes.
- No new `bin/` files, no rebuild/masking diffs, no organ diffs, no migrations touched.
