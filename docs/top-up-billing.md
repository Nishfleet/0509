# Top-Up Billing

## Products (SKU identity only)

| Pack | SKU | Checks |
|------|-----|--------|
| Burst | `burst_500_v1` | 500 |
| Campaign | `campaign_2000_v1` | 2,000 |
| Scale | `scale_7500_v1` | 7,500 |

## Checkout

- Route: `POST /api/billing/dodo/checkout` with `sku=burst_500_v1` (or legacy `bundle=proof_500` mapped server-side)
- Workspace owner authorization required for top-ups
- Checkout blocked when provider product ID is unset (503)

## Webhook grant

- `extractDodoProofCreditGrant()` resolves product ID → SKU → quantity
- `applyDodoProofCreditGrantWithLedger()` inserts into `evidence_top_up_grant` + webhook ledger in one batch
- Top-up webhooks **never** change `user_plan`

## What top-ups do not change

Plan, watchlist/board limits, seats, scan cadence, queue priority, reports, branding, delivery, API/MCP entitlements.

## Activation gate

This task does **not** configure live Dodo prices or products. Checkout remains disabled until commercial configuration is verified.
