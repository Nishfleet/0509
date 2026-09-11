# claim/issue-2448 — billing lifecycle recovery deferral cap

Issue: Nishfleet/0509#2448 (Kimi K3 Max finding M15, Fable-verified)

## What was broken

- `recoverAbandonedBillingLifecycleEmails` deferral branch (`payload && !currentEmail`)
  rewrote `updated_at` each sweep without writing `recoveryAttemptCount` into
  `payloadSnapshot`, so a pending/pending attempt whose recipient was missing or
  unverified was re-scanned forever and never failed terminally.
- `listStaleBillingLifecycleEmailAttempts` had the `recoveryAttemptCount < max`
  predicate only on the failed/failed (reconciled-evidence) branch, not on the
  pending/pending stale pre-dispatch branch.

## Fix

- `app/lib/delivery-billing-lifecycle-recovery.server.ts`: deferral now writes
  `{ ...attempt.payloadSnapshot, recoveryAttemptCount }` (count + 1, same field the
  claim path writes) and, once the count reaches
  `BILLING_LIFECYCLE_RECOVERY_MAX_ATTEMPTS`, finalizes the attempt
  `failed`/`failed` with the unavailable-recipient error instead of deferring
  again.
- `app/lib/data/delivery-records-attempts.server.ts`: added the same
  `COALESCE(CAST(json_extract(payload_snapshot_json, '$.recoveryAttemptCount') AS INTEGER), 0) < ?`
  predicate to the pending/pending branch so the cap is uniform.

## Same-pattern sweep

- `rg "recipient is (unavailable|not verified)"` and deferral-style
  `updatedAt: new Date()` writes: only this branch exists. The instant-alert lane
  (`listRetryableInstantAttempts`, `instant_preclaim_v1` protocol) is a different
  mechanism with no recoveryAttemptCount deferral.

## Verification

- RED (sources reverted to origin/main): both new tests failed (`failed: 0`
  where terminal failure expected); the new
  `stale-pre-dispatch-budget-exhausted` row was selected by the uncapped query.
- GREEN: `npx vitest run --configLoader runner --project node
  tests/delivery-billing-lifecycle-recovery-deferral.test.ts
  tests/billing-lifecycle-attempts-data.test.ts
  tests/delivery.billing-recovery.test.ts tests/data.server.test.ts`
  → 150/150 passed.
- Affected-tests sweep: `npx vitest run --configLoader runner --project node
  --changed origin/main` → 323 files / 4171 tests passed.
- Typecheck: not run locally (CI-owned per fleet memory-budget rule
  fleet-ops#4891; `npm run typecheck` runs in `ci.yml`).
