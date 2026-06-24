# Dodo Catalog Compatibility

Maps internal v1 billing SKUs to **existing** Dodo products via Worker secrets. **No product IDs in this document.**

## Adapter model

```
checkout SKU slug  →  billing-sku-catalog.ts  →  DODO_0509_PRODUCT_* env key  →  Dodo product (live)
webhook product_id →  resolveBillingSkuFromProviderProductId()  →  same SKU slug
pricing preview    →  dodo0509ProductIds() / dodo0509UsageBundleProductIds()  →  same env keys
```

Unknown or unmapped product IDs fail closed at webhook grant and checkout session creation.

## v1 SKU → env key mapping

| Internal SKU | Purchase type | Env key (secret name) |
|--------------|---------------|------------------------|
| `scout_monthly_v1` | Subscription | `DODO_0509_PRODUCT_SCOUT_MONTHLY_ID` |
| `scout_annual_v1` | Subscription | `DODO_0509_PRODUCT_SCOUT_YEARLY_ID` |
| `starter_monthly_v1` | Subscription | `DODO_0509_PRODUCT_STARTER_MONTHLY_ID` |
| `starter_annual_v1` | Subscription | `DODO_0509_PRODUCT_STARTER_YEARLY_ID` |
| `agency_monthly_v1` | Subscription | `DODO_0509_PRODUCT_AGENCY_MONTHLY_ID` |
| `agency_annual_v1` | Subscription | `DODO_0509_PRODUCT_AGENCY_YEARLY_ID` |
| `burst_500_v1` | One-time top-up | `DODO_0509_PRODUCT_PROOF_PACK_500_ID` |
| `campaign_2000_v1` | One-time top-up | `DODO_0509_PRODUCT_PROOF_PACK_2000_ID` |
| `scale_7500_v1` | One-time top-up | `DODO_0509_PRODUCT_PROOF_PACK_7500_ID` |

## Legacy aliases (webhook replay only)

| Legacy slug | Canonical SKU | Same env key as |
|-------------|---------------|-----------------|
| `proof_500_legacy` | `burst_500_v1` | `DODO_0509_PRODUCT_PROOF_PACK_500_ID` |
| `proof_2000_legacy` | `campaign_2000_v1` | `DODO_0509_PRODUCT_PROOF_PACK_2000_ID` |
| `proof_7500_legacy` | `scale_7500_v1` | `DODO_0509_PRODUCT_PROOF_PACK_7500_ID` |

## Checkout form compatibility

| Form field | Resolution |
|------------|------------|
| `sku` | Direct canonical slug |
| `plan` + `cycle` | Maps to `{plan}_{monthly\|annual}_v1` |
| `bundle` `proof_500` etc. | Maps to `burst_500_v1` etc. |

## Fail-closed behavior

| Condition | Behavior |
|-----------|----------|
| Unknown `sku` | 400 Unknown or inactive billing SKU |
| Missing env product id | 503 Dodo product is not configured |
| Unknown webhook `product_id` | Grant ignored (null extract) |
| `listSkusMissingProviderConfiguration()` | Surfaces in launch readiness / scorecard |

## Owner verification (no recreation)

1. Confirm all nine env secrets exist: `wrangler secret list` (names only).
2. Run `npm run canary:billing` — uses test webhooks, no customer charges.
3. Run `npm run canary:pricing` — preview only.
4. **Do not** create new Dodo products unless a secret name is missing entirely.

## Agency commercial gate (separate from SKU mapping)

Agency SKUs may be fully mapped while checkout remains held. See `app/lib/commercial-launch-gate.server.ts` and `docs/monitoring-fanout-rollout.md`.
