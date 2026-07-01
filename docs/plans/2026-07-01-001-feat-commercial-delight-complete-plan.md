# Plan: Commercial Delight Complete

## Goal

Make plan selection, annual billing, onboarding, and first paid value feel complete inside the authenticated Five to Nine app while preserving Dodo pricing truth, billing safety, Agency held state, and existing Search V2/Presence/evidence gates.

## Work Units

1. Add Dodo monthly and annual checkout validation to pricing preview.
2. Fail closed on checkout when live Dodo preview is missing, and fail closed on annual checkout when validation is missing, mismatched, or mispriced.
3. Move Dodo checkout returns to `/app/billing`.
4. Turn `/app/billing` into the canonical authenticated plan picker with monthly/annual selection, localized prices, current-plan state, Agency held state, and top-up purchasing.
5. Route authenticated upgrade/pick-plan CTAs to `/app/billing` with source context.
6. Preserve signed-out public plan intent through safe signup redirects.
7. Tighten onboarding copy around "Paste your competitors" and keep plan-required flows inside the app.
8. Lead Overview with the Market Desk Brief after critical billing banners.
9. Add focused tests for annual validation, checkout fail-closed behavior, billing plan picker rendering, public intent, and app CTA routing.
10. Run full verification, red-team review, CE review, autoreview, PR/deploy gates, and provenance updates.

## Constraints

- No hardcoded prices.
- No client-submitted product IDs, amounts, or credit quantities.
- No public Agency checkout unless fan-out proof gate opens.
- No customer data, secrets, provider payloads, or internal IDs in docs or responses.
- No destructive migrations or direct push to main.
