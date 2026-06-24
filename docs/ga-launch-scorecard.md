# GA Launch Scorecard

Last updated: 2026-06-24 (branch `cursor/ga-billing-sales-20260624`, Workstream A billing audit)

## Verdict

**RELEASE READY — OWNER ACTION REQUIRED**

Internal workspace secret configured; email proof canary passes on production. Billing code gate passes (9 SKUs, Scout/Starter checkout open, Agency held, top-up grants via `evidence_top_up_grant`). Slack delivery remains unverified (advertised on Starter/Agency only; Scout is email-only). Fan-out stays `inline`; live shadow/allowlist ladder not yet run.

## Phase tracker

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Protect & baseline | PASS | Branch at `cdb7b93`; CI green; 1043 tests; build/typecheck pass; remote D1 through `0053` |
| 1 | Customer journey audit | DONE | `docs/ga-customer-journey-audit.md` |
| 2 | SKU registry → Dodo | PASS | All 9 `DODO_0509_PRODUCT_*` secrets present (names verified via `wrangler secret list`) |
| 3 | Localized pricing | PASS | `npm run canary:pricing` ok (IN/US/GB) |
| 4 | Purchase lifecycle | PASS | Plan + top-up webhook grants; billing canary route tests pass; prod canary PASS per owner baseline |
| 5 | Self-serve billing | PASS | Portal route + billing UI; Scout/Starter checkout + top-ups open; Agency held at checkout |
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
| 17–19 | Merge/deploy/smokes | IN PROGRESS | PR #236 merged (`0252461`); billing workstream tests green; prod smokes owner-confirmed |

## Gate evidence (2026-06-24 Workstream A billing audit)

| Gate | Scope | Result | Evidence |
|------|-------|--------|----------|
| Preflight | Branch | PASS | `0252461` (PR #236 merged), CI green |
| Tests/build | Local | PASS | 1043 passed; typecheck + build ok |
| D1 remote | Prod | PASS | Migrations through `0053` |
| 9 Dodo SKU secrets | Prod | PASS | All nine `DODO_0509_PRODUCT_*` names in `wrangler secret list` |
| Internal workspace secret | Prod | **PASS** | `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` present in secret list (name only) |
| Internal workspace D1 | Prod | PASS | Exactly one canary user; 3 active watchlists; 4 email targets; 0 slack targets |
| Email proof canary | Prod | **PASS** | `npm run canary:proof` (no `--require-slack`): 1 email delivery attempt, ok |
| Slack proof canary | Prod | **FAIL** | Not run with `--require-slack`; 0 slack targets in canary workspace |
| Prod canary ops (read-only) | Prod | **FAIL** | `no_slack_delivery_target`, `no_recent_slack_sent` (Slack not launch-blocking for Scout) |
| Pricing canary | Prod | PASS | IN ₹999, US $11, GB £9 |
| Billing canary | Prod | PASS | `npm run canary:billing` — plan grant + `proofCreditsGranted` (owner baseline) |
| Billing canary route | Local | PASS | 3/3 route tests + expanded billing/webhook suites |
| Fan-out shadow | Simulated | PASS | vitest shadow mode — no D1 runs/workflows |
| Fan-out 75-job dispatch | Simulated | PASS | vitest `schedules 75 eligible watchlists` |
| Fan-out mixed fleet | Simulated | PASS | vitest queue priority + slot drain tests |
| Fan-out live (allowlist) | Prod | NOT RUN | `inline` mode; secret set; ladder not activated |
| Health endpoint | Prod | PASS | `https://0509.io/api/health` → 200 |
| UptimeRobot | External | UNVERIFIED | Owner confirmed; no API token |
| Portal session route | Code | PASS | `POST /api/billing/dodo/portal` |
| PR merge | — | PASS | PR #236 merged to `main` at `0252461` |

## Baseline (Phase 0)

| Item | Value |
|------|-------|
| Branch | `cursor/ga-billing-sales-20260624` |
| HEAD | `0252461` (PR #236 merged) |
| PR | #236 merged |
| Health | `https://0509.io/api/health` → 200 |
| Remote D1 | No migrations to apply (through `0053`) |
| Tests | 1043 passed / 120 files |
| `MONITORING_FANOUT_MODE` | `inline` (wrangler vars) |

## Commercial sale state (code + evidence)

| Plan | Code sale open | Prod enable | Blocker |
|------|----------------|-------------|---------|
| Scout | Yes | **Yes** | None — checkout + top-ups open |
| Starter | Yes | **Yes** | None — checkout + top-ups open (Slack advertised but not code-gated) |
| Agency | No | **No** | Fan-out not proven; `inline` mode; checkout redirects to `agency-held` |

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

1. **Deploy billing workstream branch** if test additions land after last prod deploy.
2. **Optional Slack proof** — add disposable internal Slack target to canary workspace; `npm run canary:proof -- --require-slack` (does not block Scout GA).
3. **Fan-out activation ladder** (`docs/monitoring-fanout-rollout.md`): shadow → allowlist (concurrency 1, notifications off) → 75-job proof → one nightly window before Agency sale. Do not set `MONITORING_FANOUT_GLOBAL=1` until pilot proof.
4. **UptimeRobot** — owner confirmed; optional automated verification.

## Fan-out mode

| Setting | Value |
|---------|-------|
| `MONITORING_FANOUT_MODE` | `inline` |
| `MONITORING_FANOUT_GLOBAL` | unset |
| `MONITORING_FANOUT_ALLOWLIST` | unset |
| `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` | configured (secret name verified) |
| Production proof | None — vitest simulated only |

## Next update

After fan-out shadow on internal workspace (mode `shadow`, no global activation), refresh before Agency sale enablement.
