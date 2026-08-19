# Plan Catalog

Authoritative entitlements live in `app/lib/plan-entitlements.ts`. Prices are loaded from Dodo at runtime — never hardcode monetary amounts in entitlement logic.

## Plans

| Plan | Watchlists | Boards | Included proof captures / month | Monitoring | Digests | Seats |
|------|------------|--------|----------------------------------|------------|---------|-------|
| Free | 1 | 1 | 1 | Instant activation scan on first watchlist, then weekly (Monday 03:00 UTC slot of the regular cron; scans prefer any shared discovery-cache entry ≤7 days old before scraping live) | Weekly | 1 |
| Scout | 3 | 10 | 50 | Every 6 hours | Weekly | 1 |
| Starter | 10 | 25 | 250 | Every 3 hours | Daily + weekly | 1 |
| Agency | 75 | 250 | 2,500 | Top 25 every 3 hours, rest every 6 hours (highest queue priority) | Daily + weekly | 3 (owner included) |

## Monthly included allowance

- Anchored to the workspace **subscription entitlement anchor** (`user_plan.evidence_entitlement_anchor`), not the UTC calendar month.
- Annual subscriptions receive a fresh monthly bucket on the same anniversary cadence (not an upfront yearly pool).
- Unused included proof captures **do not roll over**.
- Plan upgrades during a period raise the current period allowance; downgrades clamp remaining included balance to zero without clawing back recorded usage.

## Top-ups

- Burst Pack 500 / Campaign Pack 2,000 / Scale Pack 7,500 proof captures. Quantities are fixed in code; prices load from Dodo at runtime and are verified by the live pricing canary.
- Purchased proof captures **never expire** and remain owned after cancellation.
- Spending top-ups requires an active Scout, Starter, or Agency plan.

## Feature gating

Use `canUsePlanFeature(plan, feature)` and `requireWorkspacePlanFeature()` — never infer capabilities from price or plan ordering alone.

Server routes, API/MCP tools, exports, shares, reports, Slack delivery, and account actions enforce features in `app/lib/plan-feature-gate.server.ts`.

### Delivery

- **Save-time:** `requireDeliveryConfigSave()` rejects forbidden Slack/instant/email toggles before persisting watchlist or workspace delivery config. Stored config is retained on downgrade.
- **Execution-time:** `applyDeliveryEntitlements()` strips disallowed channels before digest/instant sends. Downgraded workspaces keep webhooks/targets but nothing sends until the plan restores access.
- **Top-ups** grant proof captures only — they do not unlock Slack, instant alerts, or agency branding.

### Agency branding

- **Save-time:** only Agency may call `save-report-branding`; branding rows persist on downgrade.
- **Render-time:** `resolveWorkspacePreparedBy()` checks the share/report owner's live plan before showing "Prepared by …". Starter/Scout/canceled plans always show Five to Nine branding on public shares and PDFs.

### Pricing

Checkout SKUs are mapped in `app/lib/billing-sku-catalog.ts` and provider product IDs are supplied by environment. Public prices and checkout totals come from Dodo localized pricing preview, not this document. Unknown, inactive, or unmapped SKUs fail closed at checkout. Partial refunds are an owner decision — ledger code revokes on full refund only.

## Proof captures

Scheduled monitoring is included. One proof capture = one successful, unique, newly produced landing-page proof capture.

Customer copy: see `EVIDENCE_USAGE_CUSTOMER_COPY` in `app/lib/pricing.ts`.

## Historical production status (2026-07-01)

The entitlement catalog and evidence usage accounting were live on the dated production version. Dodo checkout, signed-webhook billing, top-ups, and Scout/Starter monthly and annual localized pricing passed the dated launch canaries. This is not current-candidate evidence; the canonical release verdict is 0/6 until the exact all-six Gate A–C proof and deployed canaries pass.
