# Plan Catalog

Authoritative entitlements live in `app/lib/plan-entitlements.ts`. **No prices.**

| Plan | Watchlists | Boards | Included checks / month | Seats | Scan cadence | Queue priority |
|------|------------|--------|-------------------------|-------|--------------|----------------|
| Scout | 3 | 10 | 50 | 1 | Monday scheduled | 2 (lowest paid) |
| Starter | 10 | 25 | 250 | 1 | Daily | 1 |
| Agency | 75 | 250 | 2,500 | 3 total (owner + 2 teammates) | Daily | 0 (highest paid) |

## Feature flags

Use `canUsePlanFeature(plan, feature)` — never infer capabilities from price or plan ordering alone.

## Workspace resolution

Members inherit the workspace owner's effective plan via `getUserPlanForActor` / `resolveWorkspace`.

## Unresolved owner decisions

See `app/lib/evidence-usage-policies.server.ts` for top-up spend after cancellation, refund partials, ownership transfer, and workspace merge.
