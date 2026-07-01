# Commercial Delight Complete Audit

Date: 2026-07-01

## Current Root Cause

The commercial foundation is partly present but split across public pricing, Dodo checkout routes, and account usage pages. Dodo localized preview is already the price source, but the authenticated app does not yet make plan choice feel native, and annual checkout lacks a server-side proof that the annual SKU earns the "4 months free" claim.

## Surface Audit

- Homepage pricing: polished and Dodo-backed, but signed-in users can still start checkout from the public page instead of choosing inside the app.
- In-app billing: shows current plan and usage, but not a first-class Scout/Starter/Agency picker.
- Upgrade CTAs: several authenticated plan-limit and capacity moments link to `/#pricing`.
- Annual option: annual SKUs are present in the catalog, but no validation proves annual equals eight monthly periods in the same Dodo pricing context.
- Checkout return: Dodo checkout returns to `/app?checkout=dodo`; billing recovery should land on `/app/billing`.
- Top-ups: product semantics are correct, but the authenticated buying moment belongs in billing with paid-plan context.
- Agency: launch gate already holds Agency checkout behind fan-out proof.
- Onboarding: bulk paste/import exists and enforces plan caps, but copy and free-plan paths still point outward.
- Market Desk Brief: overview has a brief surface, but setup/readiness/nudge panels can appear before first value.
- Search answer: summary coverage exists; no evidence found of a commercial blocker in the baseline focused tests.
- Copy risks: avoid "delivered" unless recipient-delivery proof exists; use completed-check language for all-quiet states.

## Decision Record

- Keep Dodo as the only pricing source of truth.
- Do not hardcode visible currency or fixed prices.
- Validate every monthly and annual plan checkout against a fresh Dodo preview.
- Validate "4 months free" by comparing Dodo preview annual amount to `8 * monthly amount` for the same plan, currency, and billing context.
- If annual validation fails, disable only that annual CTA, keep monthly checkout live, and record a safe owner action.
- Keep Agency checkout held unless the existing fan-out proof gate opens it.
- Avoid a new schema migration unless a real durable-state gap blocks the requested customer outcome.

## Dodo Parity Notes

- Official Dodo checkout preview returns the selected `product_cart` details, including product id, subscription type, price, currency, and billing country; checkout validation must use that fresh preview before creating a session.
- Official Dodo checkout session creation returns a hosted `checkout_url`; the app must only redirect to Dodo-hosted checkout URLs.
- Official Dodo webhook docs distinguish retryable payment failures from initial subscription/mandate creation failure. `payment.failed`, `subscription.failed`, and `subscription.on_hold` stay in the paid-plan payment-issue path unless `subscription.failed` clears the actual matching pending checkout lock for initial mandate creation.
- The `8 * monthly amount` rule is a Five to Nine business validation for the public "4 months free" claim, not a Dodo platform invariant.
