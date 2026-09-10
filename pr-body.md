## What

A Dodo webhook redelivery that lands while another worker holds a live
processing lease was acked HTTP 200 (`{ ok: true, duplicate: true, inProgress: true }`).
That 200 tells Dodo to stop retrying. If the worker holding the lease dies
before finalizing, the payment is stranded: the lease expires but the only
reclaim path is a later delivery of the same event, which never comes.

The sibling `deferred` state already answers 503 + `retry-after: 60` for
exactly this not-owned-work case. This change makes `in_progress` answer the
same way, so Dodo redelivers after the lease expires and the reclaim path can
pick the work back up.

## Change

- `app/routes/api.webhooks.dodo.ts`: the `in_progress` claim now throws a 503
  Response with `cache-control: no-store` and `retry-after: 60`, matching the
  `deferred` path. The processed/duplicate 200 path is unchanged.
- `tests/dodo-webhook.route.test.ts`: new test asserting a redelivery during a
  live processing lease returns 503 with the correct headers and performs no
  business mutation.

## must-not respected

- Lease duration unchanged.
- Processed/duplicate 200 path unchanged.
- No scheduled sweep added.
- Signature verification untouched.

## Verification

Ran the affected test file and the full node + workers test projects:

```
$ npx vitest run --configLoader runner --project node tests/dodo-webhook.route.test.ts
Test Files  1 passed (1)
     Tests  76 passed (76)

$ npx vitest run --configLoader runner --project node
Test Files  651 passed (651)
     Tests  7738 passed (7738)

$ npx vitest run --configLoader runner --project workers
Test Files  46 passed (46)
     Tests  231 passed (231)

$ npm run typecheck
exit 0
```

run-proof: 76/76 route tests, 7738/7738 node tests, 231/231 workers tests, typecheck exit 0

## Acceptance

- Redelivery during a live lease returns 503. ✓ (new test)
- A processed event still returns 200 duplicate. ✓ (existing test at
  "skips processing entirely when the event was already claimed")

net-positive-because: a bug fix that adds a regression test for a stranded-payment path; the added lines are the test and the 503 branch that closes the gap.

## Review

Reviewer seat: cursor/cursor-grok-4.6-high

- Act on: none.
- Consider: the billing canary harness (api.billing.dodo.canary.ts) invokes the real
  webhook action; a thrown 503 now surfaces as a rejected promise mapped to
  `{ ok: false, status: 500 }`. Non-production verification harness; correctly signals
  the webhook was not processed. No action required.
- Noted: the e2e replay harness (api.e2e.billing.replay.ts) throws on `!response.ok`;
  in practice it uses fresh event IDs (claimed) and the duplicate path, so `in_progress`
  should not arise. Test-only harness. No action required.
- Dismissed-with-reason: the new test mocks `beginDodoWebhookEventProcessing` to return
  `in_progress` rather than seeding a real DB row. This matches the established pattern
  in the file (the duplicate test does the same) and directly exercises the route's
  `in_progress` branch; the data-layer lease semantics are already covered by
  `dodo-billing-webhook-lease-atomicity.test.ts`.

Closes #2257
