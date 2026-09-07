## Summary

The daily market-signal `billing_problem_events_24h` metric counted every
problem-outcome `dodo_webhook_event`, including internal billing-canary
replays (`event_type 'billing.canary.lock'`). Production classification
(issue #1942) shows **all 249 all-time problem rows are canary** — zero
real-user payment confirmations have ever failed. The metric therefore
false-alarmed on internal replays and could not distinguish them from a
real failed payment confirmation.

This change makes the metric honest (exclude canary event types) and pins
the exclusion with a canary-style regression test so the query semantics
cannot silently regress.

## Acceptance 1 — classification (recorded in repo)

Production D1 classification, last 14 days:

| origin | event_type | outcome | n |
|---|---|---|---|
| canary | billing.canary.lock | failed | 152 |
| real-user | — | — | 0 |

All-time (no window filter):

| origin | event_type | outcome | n |
|---|---|---|---|
| canary | billing.canary.lock | failed | 249 |
| real-user | — | — | 0 |

Recorded in the repo at `.lane/reports/claim-issue-1942-dodo-problem-classification.md`.

## Acceptance 2 — real-user problem rows

**None exist.** Every problem-outcome row is an internal canary replay. The
money path is proven green — no real-user payment confirmation has ever
failed, so there is no root cause to fix and no row to re-drive.

## Acceptance 3 — prevention mechanism

- **(a)** `scripts/market-signal-snapshot.mjs`: the `billing_problem_events_24h`
  query now excludes canary event types (`event_type NOT LIKE 'billing.canary.%'`),
  so the daily signal reports only real-user payment problems.
- **(b)** `tests/billing-webhook-realuser-metric.canary.test.ts`: a canary-style
  regression test (modeled on `tests/sneaker-resale-swing-freshness.canary.test.ts`)
  that pins the canary-exclusion clause in the generated SQL and asserts the
  total-event metric stays unfiltered.

## Acceptance 4 — scope

No D1 migrations. No edits to protected verifier/deploy workflow paths
(`ci.yml`, `secret-scan.yml`, `required-verifier-integrity.yml`,
`deploy-production.yml`, `finalize-production-soak.yml`, their
`.github/scripts`, `scripts/ci-verify-*.sh`).

## Verification

- `npx vitest run --configLoader runner --project node tests/billing-webhook-realuser-metric.canary.test.ts` → **2 passed**
- `npx vitest run --configLoader runner --project node tests/market-signal-snapshot.test.ts` → **14 passed**
- Full node suite: **606 test files, 7204 tests passed**
- `sgscan scripts/market-signal-snapshot.mjs tests/billing-webhook-realuser-metric.canary.test.ts` → **No new security findings**
- Production D1 termination check (canary-excluded problem count, 14 days): **n = 0**

run-proof: `npx vitest run --configLoader runner --project node` (606 files / 7204 tests green); `sgscan` clean; production D1 classification query executed against `0509 --remote` (152 canary / 0 real-user problem rows in 14 days; 249 / 0 all-time).

## Reviewer round

Reviewer seat: `cursor/cursor-grok-4.6-high`.

- **Act on:** acceptance 1's "recorded in the repo" requirement was missing —
  added `.lane/reports/claim-issue-1942-dodo-problem-classification.md` with the
  bucket table. This also resolves the warning that acceptance 2's basis was
  unverifiable (the classification is now a committed artifact).
- **Consider:** the regression test pins the exact clause text, not the semantic
  outcome; a future equivalent-but-different exclusion would fail the test. This
  is the intended fail-loud behaviour of a canary pin — noted, no change.
- **Noted:** the `billing_event_types_json` diagnostic breakdown is intentionally
  left unfiltered (it is a breakdown, not a problem metric).

Closes #1942

net-positive-because: the added lines are a canary-style regression test (44 lines) that pins the canary-exclusion semantics and a classification record (61 lines) that satisfies acceptance 1's "recorded in the repo" requirement; the production code change is a one-line SQL exclusion. The test and record are durable prevention/evidence, not machinery.
