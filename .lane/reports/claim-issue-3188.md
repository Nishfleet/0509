## issue #3188 — email delivery canary: real-D1 coverage + honest sent-row error (follow-up)

Lane: pi-issue-0509-3188
Branch: claim/issue-3188
Base: origin/main @ 92f578fd9 (post-#3285 merge)

Context: PR #3285 merged the canary feature at 2026-09-12T13:08Z. This
follow-up completes the D1 expand/contract coverage contract — the merged
PR's integration tests touched the probes table, not the new canary table's
write path — and lands one correctness fix found while writing it.

### Reviewer round (nebius/zai-org GLM-5.3-Flash)

- Act on (fixed in this push):
  - Missing `.lane/reports/claim-issue-3188.md` — this file.
  - The `sent ? null : "send not accepted"` line was unpinned: the
    integration test now drives the REAL send path (mocked `send_email`
    binding over the real migrated D1, same pattern as
    `email-suppression-2983.integration.test.ts`) and asserts the stored
    `sent` row has `error IS NULL`; the node test pins `error` null on the
    tick's sent row too.
- Consider → applied: `sweep.markedLate` tightened to `toBe(1)` — exactly
  one row is sweepable at that point; a wider UPDATE now trips.
- Consider → Noted: test 2's global rollup depends on test 1's fixture —
  per-file isolation makes that true regardless; sequential `it` order and
  the header comment document it, matching the repo's other integration
  suites.
- Noted: CodeRabbit auto-review disabled on this repo (informational).
- Dismissed-with-reason: non-null errorMessage on a sent row (impossible —
  the delivery core returns null iff sent); negative-latency CHECK probe
  (clamped by `Math.max(0, …)`; constraint behavior proven by other
  suites); `reportError` writes to `error_report` during tests (file-scoped,
  never throws).

### Scope
- `tests/integration/email-delivery-canary.integration.test.ts` (new) —
  migration 0098 on real workerd D1: send INSERT via `sendEmailDeliveryCanary`
  with a mocked EMAIL binding → `recordCanaryReceipt` completes the round
  trip → `getEmailDeliveryStatus` 24h rollup read; late sweep marks stale
  `sent` rows `failed`; forged unmatched receipts are stored for the sink
  but excluded from the public success rate.
- `app/lib/email-delivery-canary.server.ts` — one-line fix: healthy `sent`
  rows store `error = NULL` instead of a fabricated "send not accepted by
  provider".
- `tests/email-delivery-canary.server.test.ts` — pins `error IS NULL` on the
  tick's sent row.

### Verification
- `npx vitest run --configLoader runner --project workers tests/integration/email-delivery-canary.integration.test.ts` → 2/2 pass.
- `npx vitest run --configLoader runner --project node tests/email-delivery-canary.server.test.ts` → 11/11 pass.
