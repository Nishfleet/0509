# GA Launch Scorecard

Last updated: 2026-06-24 (branch `cursor/ga-launch-customer-delight-20260624`)

## Verdict

**RELEASE READY — OWNER ACTION REQUIRED**

Scout and Starter are code-ready for self-serve checkout when production Dodo product secrets are configured. Agency checkout is intentionally held until monitoring fan-out is proven on a documented internal workspace.

## Phase tracker

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Protect & baseline | PASS | Branch created, patch saved, tests/build green, D1 migrations synced |
| 1 | Customer journey audit | DONE | `docs/ga-customer-journey-audit.md` |
| 2 | SKU registry → Dodo | DONE | v1 SKUs map via `DODO_0509_PRODUCT_*` env keys; `docs/dodo-catalog-compatibility.md` |
| 3 | Localized pricing | PASS | Dodo preview + cache tests exist |
| 4 | Purchase lifecycle | PASS | Checkout/webhooks/canary tests; mocks only in CI |
| 5 | Self-serve billing | PASS | Portal route + evidence copy on `/app/billing` |
| 6 | Onboarding | PASS | Workspace readiness checklist exists |
| 7 | Plan-specific UX | DONE | Marketing pricing + plan badges |
| 8 | Monitoring fan-out | HELD | `MONITORING_FANOUT_MODE=inline` in prod; Agency gated |
| 9 | Public pricing page | DONE | Entitlements + Dodo preview + FAQ + Agency held badge |
| 10 | Remove beta | DEFERRED | Gates not passed — see `docs/ga-positioning.md` |
| 11 | Support | DONE | `docs/ga-support-runbook.md` |
| 12 | Ops readiness | PARTIAL | Runbook written; external ops still owner-action |
| 13 | Analytics | DONE | `docs/ga-metrics.md` (structured logs only) |
| 14 | Quality | DONE | `docs/ga-quality-report.md` |
| 15 | Test matrix | PASS | 1037+ tests at phase 0 baseline |
| 16 | Commits & PR | DONE | Branch pushed, PR opened |
| 17–19 | Merge/deploy/smokes | STOPPED | Owner-action gates |

## Baseline (Phase 0)

| Item | Value |
|------|-------|
| Branch | `cursor/ga-launch-customer-delight-20260624` |
| Base commit | `9e7fa9f` (docs/plan-entitlements-release) |
| Deployed merge (reported) | `cd3e58f` (PR #234 entitlements) |
| Local patch | `../pre-ga-launch-customer-delight.patch` (empty at branch create) |
| Health | `https://0509.io/api/health` → 200 `{ status: "ok" }` |
| Remote D1 | No migrations to apply (through `0053`) |
| D1 backup validate | PASS (dry-run) |
| Typecheck | PASS |
| Tests | 1043 passed / 120 files (post-GA branch) |
| Build | PASS |
| `MONITORING_FANOUT_MODE` | `inline` (wrangler vars) |

## Commercial sale state (code)

| Plan | Sale open | Blocker |
|------|-----------|---------|
| Scout | Yes | — |
| Starter | Yes | — |
| Agency | No | Fan-out not proven (`inline` mode; internal workspace undocumented) |

## Owner actions (blocking GA LIVE — ALL PLANS)

1. Set `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` to the internal pilot workspace owner user id.
2. Run fan-out activation ladder (`docs/monitoring-fanout-rollout.md`): shadow → allowlist → nightly proof.
3. Configure production Slack delivery + `npm run canary:proof -- --require-slack`.
4. Enable Dodo customer portal subscription updates in dashboard.
5. Create UptimeRobot monitor on `/api/health`.
6. Confirm all nine `DODO_0509_PRODUCT_*` secrets are set in Worker (no IDs in repo).

## Next update

Re-run `npm test && npm run build` after each phase commit and refresh test counts here.
