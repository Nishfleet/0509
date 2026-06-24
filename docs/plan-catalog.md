# Plan Catalog

Authoritative entitlements live in `app/lib/plan-entitlements.ts`. Prices are loaded from Dodo at runtime — never hardcode monetary amounts in entitlement logic.

## Plans

| Plan | Watchlists | Boards | Included evidence checks / month | Monitoring | Digests | Seats |
|------|------------|--------|----------------------------------|------------|---------|-------|
| Scout | 3 | 10 | 50 | Monday scheduled | Weekly | 1 |
| Starter | 10 | 25 | 250 | Daily scheduled | Daily + weekly | 1 |
| Agency | 75 | 250 | 2,500 | Daily scheduled, highest queue priority | Daily + weekly | 3 (owner included) |

## Monthly included allowance

- Anchored to the workspace **subscription entitlement anchor** (`user_plan.evidence_entitlement_anchor`), not the UTC calendar month.
- Annual subscriptions receive a fresh monthly bucket on the same anniversary cadence (not an upfront yearly pool).
- Unused included checks **do not roll over**.
- Plan upgrades during a period raise the current period allowance; downgrades clamp remaining included balance to zero without clawing back recorded usage.

## Top-ups

- Burst Pack 500 / Campaign Pack 2,000 / Scale Pack 7,500 evidence checks (quantities only — prices unconfigured).
- Purchased checks **never expire** and remain owned after cancellation.
- Spending top-ups requires an active Scout, Starter, or Agency plan.

## Feature gating

Use `canUsePlanFeature(plan, feature)` and `requireWorkspacePlanFeature()` — never infer capabilities from price or plan ordering alone.

Server routes, API/MCP tools, exports, shares, reports, Slack delivery, and account actions enforce features in `app/lib/plan-feature-gate.server.ts`.

## Evidence checks

Scheduled monitoring is included. One evidence check = one successful, unique, newly produced landing-page proof capture.

Customer copy: see `EVIDENCE_USAGE_CUSTOMER_COPY` in `app/lib/pricing.ts`.
