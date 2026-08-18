# GA Launch Scorecard

Last updated: 2026-06-24 (branch `cursor/ga-final-integration-20260624`, GA final integration)

> Historical scorecard. The current launch truth for the final hardening branch lives in
> `docs/final-self-serve-ga-scorecard.md`; do not use this file as the live GA verdict.

## Verdict

**SUPERSEDED — SCOUT AND STARTER WERE OPEN ON THIS HISTORICAL PASS, AGENCY HELD**

Billing + email canaries passed on production during the 2026-06-24 integration pass. Scout/Starter checkout and top-ups were open, while Agency stayed held until live fan-out ladder proof. The final 2026-06-27 branch was later merged and released via PR #251; use `docs/final-self-serve-ga-scorecard.md` for current truth.

## Phase tracker

| Phase | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Protect & baseline | PASS | `0252461`; 1062+ tests; remote D1 through `0053` |
| 1 | Customer journey audit | DONE | `docs/ga-customer-journey-audit.md` |
| 2 | SKU registry → Dodo | PASS | All 9 `DODO_0509_PRODUCT_*` secrets present |
| 3 | Localized pricing | PASS | `npm run canary:pricing` ok (IN/US/GB) |
| 4 | Purchase lifecycle | PASS | Plan + top-up grants; prod billing canary PASS |
| 5 | Self-serve billing | PASS | Portal + billing UI; Scout/Starter + top-ups open |
| 6 | Onboarding | PASS | Workspace readiness checklist |
| 7 | Plan-specific UX | DONE | Email-only GA copy; Agency held gate |
| 8 | Monitoring fan-out | HELD | `inline` in prod; simulated PASS; live ladder NOT RUN |
| 9 | Public pricing page | PASS | `/api/pricing-preview` live |
| 10 | Remove beta | DONE 2026-08-12 | Product-wide beta graduated; Meta ads graduated after the production canary went green (Gate C pass on the live worker) |
| 11 | Support | DONE | `docs/ga-support-runbook.md` |
| 12 | Ops readiness | PARTIAL | Health 200; email gate in code; UptimeRobot owner gate |
| 13 | Analytics | DONE | `docs/ga-metrics.md` |
| 14 | Quality | PASS | 1062+ tests |
| 15 | Test matrix | PASS | billing, fan-out, launch-readiness suites |
| 16 | Commits & PR | IN PROGRESS | Integration branch open |
| 17–19 | Merge/deploy/smokes | IN PROGRESS | Integration PR pending |

## Gate evidence (2026-06-24 GA final integration)

| Gate | Scope | Result | Evidence |
|------|-------|--------|----------|
| Preflight | Branch | PASS | `0252461` base + 4 workstream commits |
| Tests/build | Local | PASS | 1062 passed post-integration |
| D1 remote | Prod | PASS | Migrations through `0053` |
| 9 Dodo SKU secrets | Prod | PASS | All nine names in `wrangler secret list` |
| Internal workspace secret | Prod | PASS | `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` |
| Internal workspace D1 | Prod | PASS | Canary user; email targets; 0 slack targets |
| Email proof canary | Prod | PASS | `npm run canary:proof` — 1 email sent |
| Slack proof canary | Prod | ADVISORY | Not GA-blocking |
| Prod canary ops | Prod | PASS (post-deploy) | Email blockers; Slack → advisories |
| Pricing canary | Prod | PASS | IN ₹999, US $11, GB £9 |
| Billing canary | Prod | PASS | Plan grant + proof credits |
| Fan-out shadow | Simulated | PASS | vitest — no D1/workflows |
| Fan-out 75-job dispatch | Simulated | PASS | vitest `schedules 75 eligible watchlists` |
| Fan-out mixed fleet (75/10/3) | Simulated | PASS | vitest queue priority + slot drain |
| Fan-out canary ladder | Simulated | PASS | `tests/monitoring-fanout-canary.test.ts` |
| Fan-out live (allowlist) | Prod | NOT RUN | `inline` mode; ladder not activated |
| Agency sale gate | Code | PASS | Holds inline/shadow; opens fanout+allowlist+secret |
| Health endpoint | Prod | PASS | `https://0509.io/api/health` → 200 |
| UptimeRobot | External | OWNER | Manual verification in `docs/ops-backup-uptime.md` |
| Portal session route | Code | PASS | `POST /api/billing/dodo/portal` |

## Baseline (Phase 0)

| Item | Value |
|------|-------|
| Branch | `cursor/ga-final-integration-20260624` |
| Base | `0252461` (PR #236 merged) |
| Health | `https://0509.io/api/health` → 200 |
| Remote D1 | No migrations to apply (through `0053`) |
| `MONITORING_FANOUT_MODE` | `inline` |

## Commercial sale state

| Plan | Code sale open | Prod enable | Blocker |
|------|----------------|-------------|---------|
| Scout | Yes | **Yes** | None — checkout + top-ups open |
| Starter | Yes | **Yes** | None — email-only GA offer |
| Agency | No | **No** | Fan-out not proven live; `inline` mode |
| Top-ups | Yes | **Yes** | Requires active paid plan to consume |

## Slack product status

| Item | Status |
|------|--------|
| Entitlement catalog | `slack_delivery` preserved on Starter/Agency (dormant) |
| Public pricing copy | **Removed** — email-only for GA |
| Prod UI setup | **Hidden** — `isSlackDeliveryCustomerFacing() === false` |
| Launch readiness | Slack → `advisories`, not blockers |
| GA posture | Not offered at GA; flip `ga-customer-surface.ts` when verified |

## Owner actions (remaining)

1. **Fan-out activation ladder** (`docs/monitoring-fanout-rollout.md`): shadow → allowlist (`MAX_INFLIGHT=1`, notifications off) → 75-job → one nightly window. Validate with `node scripts/monitoring-fanout-canary.mjs --step <step> --remote`.
2. **UptimeRobot** — owner verification on `0509.io/api/health`.
3. **Agency sale** — only after live fan-out ladder passes.

## Fan-out mode

| Setting | Value |
|---------|-------|
| `MONITORING_FANOUT_MODE` | `inline` |
| `MONITORING_FANOUT_GLOBAL` | unset |
| `MONITORING_FANOUT_ALLOWLIST` | unset |
| `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` | configured (secret name verified) |
| Simulated proof | PASS |
| Live proof | NOT RUN |

## Agency sale verdict

**HOLD** — Do not open Agency checkout until owner completes live ladder. Code correctly gates Agency in `inline`/`shadow`.

## Next update

After PR #251 release, the next product unlock is live fan-out shadow on an internal workspace.
