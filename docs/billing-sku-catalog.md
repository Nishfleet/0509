# Billing SKU Catalog

Versioned commercial identities live in `app/lib/billing-sku-catalog.ts`. **No monetary amounts.**

## Active checkout SKUs

| SKU | Type | Entitlement |
|-----|------|-------------|
| `scout_monthly_v1` / `scout_annual_v1` | Subscription | Scout |
| `starter_monthly_v1` / `starter_annual_v1` | Subscription | Starter |
| `agency_monthly_v1` / `agency_annual_v1` | Subscription | Agency |
| `burst_500_v1` | One-time top-up | 500 evidence checks |
| `campaign_2000_v1` | One-time top-up | 2,000 evidence checks |
| `scale_7500_v1` | One-time top-up | 7,500 evidence checks |

Grandfathered webhook SKUs: `proof_500_legacy`, `proof_2000_legacy`, `proof_7500_legacy`.

## Rules

- Checkout accepts trusted internal SKU slugs only (`sku` form field).
- Credit quantity is derived from SKU identity — never from client metadata.
- Provider product IDs map through environment configuration (`DODO_0509_PRODUCT_*`).
- Missing provider configuration disables checkout and surfaces in launch readiness via `listSkusMissingProviderConfiguration()`.
- New pack quantities require a new SKU version (e.g. `burst_500_v2`).

## Display pricing

Monetary amounts come from Dodo checkout preview (`app/lib/dodo-pricing.server.ts`) or future versioned commercial config — not from the entitlement catalog.
