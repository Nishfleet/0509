# Plan Entitlement Audit — 2026-06-23

Baseline branch: `main` @ `b640f1b` (post fan-out dormant deploy).
Implementation branch: `cursor/plan-entitlements-topups-no-prices-20260623`.

## Sources inspected

| Area | Primary files |
|------|----------------|
| Plan limits | `app/lib/plan.server.ts` (`PLAN_LIMITS`) |
| Pricing copy | `app/lib/pricing.ts`, `app/routes/marketing.tsx` |
| Dodo mapping | `app/lib/dodo-pricing.server.ts`, `app/lib/dodo-billing.server.ts` |
| Checkout | `app/routes/api.billing.dodo.checkout.ts` |
| Proof / evidence | `app/lib/proof-policy.server.ts`, `app/lib/monitoring.server.ts` |
| Top-up credits | `migrations/0014_dodo_usage_bundles.sql`, `proof_usage_credit` |
| Monitoring cadence | `workers/schedule.ts`, `listActiveWatchlists`, `shouldIncludeScoutInScheduledMonitoring` |
| Queue order | `listActiveWatchlists` `ORDER BY CASE plan` |
| Seats | `app/lib/workspace.server.ts` (`AGENCY_SEAT_LIMIT = 3`) |
| Digests | `planAllowsDigestCadence`, `PLAN_LIMITS.digestCadence` |
| Tests | `tests/plan.server.test.ts`, `tests/pricing.test.ts`, `tests/plan-monitoring.test.ts` |

## Discrepancies (pre-implementation)

### Entitlements vs marketing

| Item | Marketing / spec | Server enforcement | Action |
|------|------------------|-------------------|--------|
| Starter digests | Daily + weekly | `digestCadence: "weekly"` only — daily digests blocked | Fix in entitlement catalog (`daily_and_weekly`) |
| Scout scans | Monday scheduled | Correct via `includeScout` on Monday 04:00 cron | Preserve |
| Agency priority | First in nightly queue | SQL `ORDER BY` agency→starter→scout | Extend with persisted `queue_priority` on runs |
| Feature flags | Many capabilities listed | No central `canUsePlanFeature`; scattered `plan ===` checks | Centralize |

### Evidence / usage accounting

| Item | Spec | Current behavior | Action |
|------|------|------------------|--------|
| Monthly included allowance | Calendar/monthly period, no rollover | Rolling 30-day window (`startOfRollingProofWindowIso`) | Replace with `evidence_usage_period` |
| Annual billing | Monthly buckets, not upfront year | Same rolling window as monthly | Monthly UTC periods regardless of billing interval |
| Top-up expiry | Never expire | `proof_usage_credit.expires_at` + 30-day grant in webhook | New `evidence_top_up_grant` ledger |
| Consumption order | Included first, then top-up | Included + expiring credits summed into one cap | Reservation service with ordered pools |
| Billable unit | Evidence check | Successful `proof_capture` rows counted | Centralize in `evidence-usage-policies.server.ts` |
| Scheduled scan vs check | Unresolved | Scheduled scans do not directly increment proof_capture; proof policy gates captures | Document; no new charge without policy change |

### Billing / SKU

| Item | Spec | Current behavior | Action |
|------|------|------------------|--------|
| SKU identity | Versioned slugs (`burst_500_v1`, etc.) | `proof_500` bundle slugs | `billing-sku-catalog.ts` |
| Client authority | SKU slug only | `plan`, `cycle`, `bundle` form fields | Accept `sku`; map legacy fields to SKU |
| Credit quantity | Server-derived from SKU | `usageBundleCreditCount` server-side; metadata also sends `credits` | Remove metadata credits; webhook uses product ID → SKU |
| Prices in code | None | `pricing.ts` uses "price loading" placeholders; Dodo preview for display | Keep; no hardcoded amounts |
| Checkout when unconfigured | Disabled | 503 if product ID missing | Unchanged + launch-readiness listing |

### Seats (Agency)

- `AGENCY_SEAT_LIMIT = 3`
- Invite cap: `existing.length >= AGENCY_SEAT_LIMIT - 1` → owner + up to **2 active/invited teammates** = **3 humans total** (owner occupies one seat; UI: `seatsUsed = members.length + 1`).
- Marketing: "3 team seats — teammates share…" — **convention: 3 total seats including owner** (not owner + 3 teammates).
- **Owner decision:** none required unless product intends owner + 3 teammates (would be 4 humans). Current code and UI are consistent at 3 total.

### Unresolved business rules (documented, not invented)

See `app/lib/evidence-usage-policies.server.ts`:

1. Top-up spend after subscription cancellation — preserve legacy credit visibility until owner policy.
2. Partial top-up refund/chargeback — idempotent adjustment ledger; operator review on ambiguity.
3. Top-up transfer on workspace ownership change — credits stay on workspace user_id until policy.
4. Workspace merge — not implemented; credits stay on source workspace.
5. Whether every scheduled monitoring run consumes an evidence check — **no** today; only billable proof captures count.

## Intentionally unchanged in this task

- No monetary prices finalized or hardcoded.
- No remote migrations, deploy, or live Dodo mutation.
- No reduction of numeric entitlements (watchlist/board/check limits match spec).
- Monitoring fan-out remains `inline` in production config.
