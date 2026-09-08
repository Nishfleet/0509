# GA Final Master Progress

Coordinator: lead GA launch orchestration
Started: 2026-06-24
Integration branch: `cursor/ga-final-integration-20260624`

> Historical coordination log. The current launch truth lives in
> `docs/final-self-serve-ga-scorecard.md`; do not use this file as the live GA verdict.

## Phase 0 — Baseline (2026-06-24)

| Item | Value |
|------|-------|
| Main HEAD | `0252461` — Merge PR #236 (customer delight) |
| Main sync | Clean; up to date with `origin/main` |
| Health | `https://0509.io/api/health` → 200 |
| Worker domains | `0509.io`, `www.0509.io`, `api.0509.io`, `0509.in`, `www.0509.in`, `api.0509.in` |
| Crons | `17 */6 * * *`, `0 4 * * *`, `0 5 * * MON` |
| `MONITORING_FANOUT_MODE` | `inline` |
| Remote D1 | No migrations to apply (through `0053`) |
| Local D1 | Pending `0053` (dev only) |
| Tests | 1043 passed / 120 files |
| Typecheck | PASS |
| Build | PASS |
| D1 backup validate | PASS (dry-run) |
| 9 Dodo SKU secrets | All nine `DODO_0509_PRODUCT_*` present (names verified) |
| Fan-out internal workspace secret | Present (name only) |
| Billing canary (prod) | PASS — plan + proof credits |
| Pricing canary (prod) | PASS — IN/US/GB |
| Email proof canary (prod) | PASS — 1 email delivery |
| Baseline patch | `../pre-final-ga-integration.patch` |

## Worktrees

| Stream | Branch | Path |
|--------|--------|------|
| Integration | `cursor/ga-final-integration-20260624` | `../0509-worktrees/ga-final-integration-20260624` |
| A Billing | `cursor/ga-billing-sales-20260624` | `../0509-worktrees/ga-billing-sales-20260624` |
| B Monitoring | `cursor/ga-agency-monitoring-20260624` | `../0509-worktrees/ga-agency-monitoring-20260624` |
| C Delight | `cursor/ga-customer-delight-20260624` | `../0509-worktrees/ga-customer-delight-20260624` |
| D Ops | `cursor/ga-ops-reliability-20260624` | `../0509-worktrees/ga-ops-reliability-20260624` |

## Shared files (coordinator only)

- `app/lib/plan-entitlements.ts`
- `app/lib/billing-sku-catalog.ts`
- `wrangler.jsonc`
- `package.json`
- `migrations/*`
- `docs/ga-launch-scorecard.md`, `docs/launch-hardening-progress.md`

## Workstream status

| Stream | Status | Notes |
|--------|--------|-------|
| A Billing | PENDING | Canaries pass; verify SKU compat + sale UI |
| B Monitoring | PENDING | Inline mode; fan-out ladder not run |
| C Delight | DONE | Slack removed from public GA offer; UI hidden |
| D Ops | PENDING | Email canary pass; UptimeRobot owner gate |
| E Red team | WAITING | After integration |
| Integration | PENDING | Merge order: A→B→C→D |

## Locked commercial contract

| Plan | Entitlements |
|------|--------------|
| Scout | 3 WL, 10 boards, 50 checks/mo, Monday, email, 1 seat |
| Starter | 10 WL, 25 boards, 250 checks/mo, daily, email (NO Slack in GA), 1 seat |
| Agency | 75 WL, 250 boards, 2500 checks/mo, daily, priority, reports/API/MCP, 3 seats — fan-out proof required |
| Top-ups | burst 500, campaign 2000, scale 7500 — never expire |

Scheduled monitoring does NOT debit evidence checks.

## Preliminary verdict

**GA LIVE — SCOUT AND STARTER FOR SALE, AGENCY HELD**

Billing + email canaries pass on deployed runtime. Agency held for fan-out proof. Slack removed from public GA offer with server-side GA flag enforcement.
