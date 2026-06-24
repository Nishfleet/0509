# GA Launch Scorecard

Last updated: 2026-06-24 (branch `cursor/ga-launch-customer-delight-20260624`, agent resume)

## Verdict

**RELEASE READY — OWNER ACTION REQUIRED**

Internal workspace secret configured; email proof canary passes on production. Billing top-up grant check still fails on **deployed** runtime until PR #236 merges and deploys (`cdb7b93` fix). Slack delivery remains unverified (advertised on Starter/Agency only; Scout is email-only). Fan-out stays `inline`; live shadow/allowlist ladder not yet run.

## Phase tracker

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Protect & baseline | PASS | Branch at `cdb7b93`; CI green; 1043 tests; build/typecheck pass; remote D1 through `0053` |
| 1 | Customer journey audit | DONE | `docs/ga-customer-journey-audit.md` |
| 2 | SKU registry → Dodo | PASS | All 9 `DODO_0509_PRODUCT_*` secrets present (names verified via `wrangler secret list`) |
| 3 | Localized pricing | PASS | `npm run canary:pricing` ok (IN/US/GB) |
| 4 | Purchase lifecycle | PARTIAL | Plan webhook ok; top-up grant check fails on **deployed** runtime; branch route tests pass |
| 5 | Self-serve billing | PARTIAL | Portal route exists; Dodo portal dashboard toggle owner-confirmed (not API-verifiable) |
| 6 | Onboarding | PASS | Workspace readiness checklist exists |
| 7 | Plan-specific UX | DONE | Marketing pricing + plan badges + Agency held gate |
| 8 | Monitoring fan-out | HELD | `MONITORING_FANOUT_MODE=inline` in prod; internal workspace secret now set; vitest simulated only |
| 9 | Public pricing page | PASS | `/api/pricing-preview` live |
| 10 | Remove beta | DEFERRED | Gates not passed |
| 11 | Support | DONE | `docs/ga-support-runbook.md` |
| 12 | Ops readiness | PARTIAL | Health 200; UptimeRobot owner-confirmed; Slack target not configured for canary workspace |
| 13 | Analytics | DONE | `docs/ga-metrics.md` |
| 14 | Quality | PASS | 1043 tests / 120 files |
| 15 | Test matrix | PASS | Includes launch-gate, billing-canary, fan-out suites |
| 16 | Commits & PR | DONE | PR #236 open, mergeable |
| 17–19 | Merge/deploy/smokes | IN PROGRESS | Secret + email canary done; merge/deploy + billing rerun pending |

## Gate evidence (2026-06-24 agent resume)

| Gate | Scope | Result | Evidence |
|------|-------|--------|----------|
| Preflight | Branch | PASS | `cdb7b93`, CI green |
| Tests/build | Local | PASS | 1043 passed; typecheck + build ok |
| D1 remote | Prod | PASS | Migrations through `0053` |
| 9 Dodo SKU secrets | Prod | PASS | All nine `DODO_0509_PRODUCT_*` names in `wrangler secret list` |
| Internal workspace secret | Prod | **PASS** | `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` present in secret list (name only) |
| Internal workspace D1 | Prod | PASS | Exactly one canary user; 3 active watchlists; 4 email targets; 0 slack targets |
| Email proof canary | Prod | **PASS** | `npm run canary:proof` (no `--require-slack`): 1 email delivery attempt, ok |
| Slack proof canary | Prod | **FAIL** | Not run with `--require-slack`; 0 slack targets in canary workspace |
| Prod canary ops (read-only) | Prod | **FAIL** | `no_slack_delivery_target`, `no_recent_slack_sent` (Slack not launch-blocking for Scout) |
| Pricing canary | Prod | PASS | IN ₹999, US $11, GB £9 |
| Billing canary | Prod | **FAIL** | Plan grant ok; `proofCreditsGranted=false` on deployed worker (fix on branch, not deployed) |
| Billing canary route | Local (branch) | PASS | 3/3 tests after `cdb7b93` fix |
| Fan-out shadow | Simulated | PASS | vitest shadow mode — no D1 runs/workflows |
| Fan-out 75-job dispatch | Simulated | PASS | vitest `schedules 75 eligible watchlists` |
| Fan-out mixed fleet | Simulated | PASS | vitest queue priority + slot drain tests |
| Fan-out live (allowlist) | Prod | NOT RUN | `inline` mode; secret set; ladder not activated |
| Health endpoint | Prod | PASS | `https://0509.io/api/health` → 200 |
| UptimeRobot | External | UNVERIFIED | Owner confirmed; no API token |
| Portal session route | Code | PASS | `POST /api/billing/dodo/portal` |
| PR merge | — | PENDING | Merge after deploy path confirmed |

## Baseline (Phase 0)

| Item | Value |
|------|-------|
| Branch | `cursor/ga-launch-customer-delight-20260624` |
| HEAD | `cdb7b93` (billing canary fix) |
| PR | #236 |
| Health | `https://0509.io/api/health` → 200 |
| Remote D1 | No migrations to apply (through `0053`) |
| Tests | 1043 passed / 120 files |
| `MONITORING_FANOUT_MODE` | `inline` (wrangler vars) |

## Commercial sale state (code + evidence)

| Plan | Code sale open | Prod enable | Blocker |
|------|----------------|-------------|---------|
| Scout | Yes | **No** | Merge/deploy + billing canary pass post-deploy |
| Starter | Yes | **No** | Merge/deploy + billing canary pass post-deploy (Slack advertised but not code-gated) |
| Agency | No | **No** | Fan-out not proven; `inline` mode |

## Slack product status

| Item | Status |
|------|--------|
| Entitlement catalog | `slack_delivery` + `export_slack_ready` on Starter and Agency only; Scout is email-only |
| Public pricing copy | Starter/Agency list "Email + Slack delivery" |
| Prod UI setup | Slack controls exist in delivery settings; no canary workspace Slack target configured |
| Generic read-only canary | Flags `no_slack_delivery_target` / `no_recent_slack_sent` |
| Checkout gating | Scout/Starter checkout not blocked by Slack in `commercial-launch-gate.server.ts`; Agency held for fan-out only |
| GA posture | **Held unverified** — do not claim Slack proven; disposable internal Slack test still required before advertising as verified |

## Owner actions (remaining)

1. **Merge + deploy PR #236** — billing canary top-up grant uses `evidence_top_up_grant` on branch; deployed worker fails until deploy.
2. **Re-run `npm run canary:billing`** after deploy.
3. **Optional Slack proof** — add disposable internal Slack target to canary workspace; `npm run canary:proof -- --require-slack` (does not block Scout GA).
4. **Fan-out activation ladder** (`docs/monitoring-fanout-rollout.md`): shadow → allowlist (concurrency 1, notifications off) → 75-job proof → one nightly window before Agency sale. Do not set `MONITORING_FANOUT_GLOBAL=1` until pilot proof.
5. **UptimeRobot** — owner confirmed; optional automated verification.

## Fan-out mode

| Setting | Value |
|---------|-------|
| `MONITORING_FANOUT_MODE` | `inline` |
| `MONITORING_FANOUT_GLOBAL` | unset |
| `MONITORING_FANOUT_ALLOWLIST` | unset |
| `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` | configured (secret name verified) |
| Production proof | None — vitest simulated only |

## Next update

After merge + deploy + billing canary pass, run fan-out shadow on internal workspace (mode `shadow`, no global activation), then refresh before Agency sale enablement.
