# Evidence Usage Accounting

## Billable unit

One evidence check = one **successful proof capture** (`defineEvidenceCheckBillableUnit()` in `evidence-usage-policies.server.ts`).

Scheduled monitoring scans are not evidence checks unless a billable proof capture occurs.

## Monthly included allowance

- Table: `evidence_usage_period`
- UTC calendar month boundaries (`period_start` → `period_end`)
- Allowance captured at period creation; resets each month with **no rollover**
- Annual subscriptions receive a fresh monthly bucket (not upfront yearly pool)

## Top-up grants

- Table: `evidence_top_up_grant` — **no expiry**
- Immutable grant rows; adjustments via `evidence_top_up_adjustment`
- Legacy `proof_usage_credit` rows (30-day expiry) remain readable during transition

## Consumption order

1. Current-period included allowance (`evidence_usage_reservation` + `included_consumed`)
2. Purchased top-up balance (FIFO by `granted_at`)

## Reservations

- `evidence_usage_reservation` with deterministic `logical_operation_key`
- Reserve before expensive work; settle on success; release on failure or expiry
- Duplicate logical keys do not double-charge

## API surface

- `getEvidenceUsageSummary()` — workspace usage snapshot
- `reserveEvidenceCheck()` / `settleEvidenceReservation()` / `releaseEvidenceReservation()`
- `getProofUsageSummary()` in `plan.server.ts` wraps evidence usage with legacy fallback
