# Top-up Billing

## SKUs (quantities only)

| Slug | Checks |
|------|--------|
| `burst_500_v1` | 500 |
| `campaign_2000_v1` | 2,000 |
| `scale_7500_v1` | 7,500 |

Prices remain unconfigured in Dodo until owner activates checkout.

## Grant semantics

- Grants are immutable; provider payment id is unique per grant.
- No expiry timestamp — ownership survives cancellation, price changes, and SKU retirement.
- Spending requires an active Scout, Starter, or Agency plan (`topUpSpendRequiresActivePaidPlan`).
- Canceled workspaces retain balance; UI explains purchased checks return when a paid plan is active.

## Ledger

- Consumption, release, refund, and adjustments append to `evidence_top_up_ledger_entry`.
- `quantity_remaining` on the grant row is a cache updated in the same transaction as ledger writes.
- Refunds use `applyTopUpRefundAdjustment()` with idempotent keys.

## Legacy cutover

- `migrateLegacyTopUpCreditsIfNeeded()` imports unmigrated `proof_usage_credit` rows once.
- Migrated legacy ids are excluded from legacy fallback reads.

## Webhook path

- `applyDodoProofCreditGrantWithLedger()` in `data.server.ts` inserts grants idempotently by `provider_payment_id`.
