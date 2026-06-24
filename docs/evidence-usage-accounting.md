# Evidence Usage Accounting

## Billable unit

One evidence check = one **successful landing-page proof capture** (`defineEvidenceCheckBillableUnit()` in `evidence-usage-policies.server.ts`).

Scheduled monitoring scans are not evidence checks unless a billable proof capture occurs.

## Monthly included allowance

- Table: `evidence_usage_period`
- **Subscription-anchored** month boundaries from `user_plan.evidence_entitlement_anchor` (provider subscription start → plan activation → one-time fallback).
- Month-end anchors use deterministic clamped anniversary math (e.g. Jan 31 → Feb 28/29, returns to 31 when valid).
- Allowance captured at period creation; resets each entitlement month with **no rollover**.
- Annual subscriptions receive a fresh monthly bucket on the same anniversary cadence.

## Top-up grants

- Table: `evidence_top_up_grant` — **no expiry**
- Immutable grant rows (`quantity_granted`, provider payment identity, SKU identity)
- `quantity_remaining` is a **cache** maintained transactionally with `evidence_top_up_ledger_entry`
- Authoritative balance = `quantity_granted + SUM(ledger.quantity_delta)` per grant
- Legacy `proof_usage_credit` rows migrate once via `proof_usage_credit_migration` (no double count)

## Consumption order

1. Current-period included allowance (`evidence_usage_reservation` + `included_consumed`)
2. Purchased top-up balance (FIFO by `granted_at`) while an active paid plan is present

## Reservations

- `evidence_usage_reservation` with deterministic `logical_operation_key`
- Reserve before expensive work; settle on success; release on failure or expiry
- Duplicate logical keys do not double-charge

## API surface

- `getEvidenceUsageSummary()` — workspace usage snapshot
- `reserveEvidenceCheck()` / `settleEvidenceReservation()` / `releaseEvidenceReservation()`
- `rebuildTopUpGrantBalance()` / `rebuildWorkspaceTopUpBalance()` — cache verification
- `getProofUsageSummary()` in `plan.server.ts` wraps evidence usage with legacy fallback
