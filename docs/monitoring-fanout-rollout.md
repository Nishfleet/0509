# Monitoring Fan-Out Rollout Runbook

**Status:** DORMANT CODE — merge and deploy with `MONITORING_FANOUT_MODE=inline` only

## Production reality after dormant deploy

- Fan-out **code ships** with production, but **behavior remains inline** until explicitly activated.
- `MONITORING_FANOUT_MODE=inline` is the production default.
- `MONITORING_FANOUT_GLOBAL` must remain unset/`0`.
- Do not set `MONITORING_FANOUT_ALLOWLIST=*` until after pilot proof.
- Migrations `0047` and `0048` are additive schema only; they do not activate fan-out.

## Prerequisites

- Migrations `0047_monitoring_fanout_orchestration.sql` and `0048_monitoring_concurrency_slots.sql` applied **before** Worker deploy
- Existing `MONITORING_WORKFLOW` binding in `wrangler.jsonc`
- `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` secret configured (internal pilot workspace; never commit a value)
- No Cloudflare Queue provisioning required

## Configuration (`wrangler.jsonc` vars)

| Var | Production default | Purpose |
|-----|-------------------|---------|
| `MONITORING_FANOUT_MODE` | `inline` | `inline` / `fanout` / `shadow` |
| `MONITORING_FANOUT_ALLOWLIST` | unset | Comma-separated workspace user IDs; never `*` in dormant deploy |
| `MONITORING_FANOUT_GLOBAL` | unset | `1` only after multi-window pilot proof |
| `MONITORING_FANOUT_MAX_INFLIGHT` | `8` | Clamped to `64` (`MONITORING_CONCURRENCY_SLOT_CAPACITY`) |
| `MONITORING_ORCHESTRATION_LEASE_MS` | `3600000` (60 min) | Must exceed 45 min scan timeout + 15 min margin |
| `MONITORING_CONCURRENCY_SLOT_LEASE_MS` | `3600000` (60 min) | Aligned with orchestration lease |

## Architecture summary

- **Logical key (D1):** `watchlist-run:{trigger}:{watchlistId}:{cron}:{slot}`
- **Workflow instance ID:** `monitor-v1-{sha256-base64url}` (≤100 chars, Cloudflare-valid)
- **Dispatch:** `MONITORING_WORKFLOW.createBatch()` (idempotent on duplicate IDs)
- **Concurrency:** atomic `monitoring_concurrency_slot` claims (64 seeded rows)
- **Missing binding:** explicit fan-out records `workflow_binding_missing`, does **not** inline-scan
- **Shadow:** counts eligible watchlists only; no D1 runs, no workflows, no deliveries

## Schema-first deployment order

1. `npx wrangler d1 migrations list 0509 --remote` — confirm pending is exactly `0047`, `0048`
2. `npx wrangler d1 migrations apply 0509 --remote`
3. Confirm `No migrations to apply`
4. `npm run deploy` with `MONITORING_FANOUT_MODE=inline`
5. Post-deploy health checks (home, `/api/health`, auth, Dodo webhook route)

## Proof matrix: simulated vs live

| Ladder step | Simulated (vitest) | Live (owner) | Pass criteria |
|-------------|-------------------|--------------|---------------|
| **Config** | `tests/monitoring-fanout-canary.test.ts` | `node scripts/monitoring-fanout-canary.mjs --step config` | `inline` default; internal workspace secret set; no `GLOBAL=1` |
| **Shadow** | `tests/monitoring-fanout.test.ts` shadow mode | Set `MONITORING_FANOUT_MODE=shadow`, observe one cron window | `shadowOnly > 0`; zero `watchlist_run` rows; no deliveries |
| **Allowlist (1 watchlist)** | dispatch + binding-missing tests | `fanout` + allowlist internal user ID, `MAX_INFLIGHT=1`, notifications off | Exactly one queued/dispatched run; `dispatchFailures = 0` |
| **75-job fleet** | `schedules 75 eligible watchlists` | Internal workspace with 75 active agency watchlists | `queued >= 75`; `dispatchFailures = 0`; slots ≤ `MAX_INFLIGHT` |
| **Mixed 75/10/3 fleet** | `monitoring-queue-priority` + mixed scheduling test | Optional stress on internal workspace (Monday window for scout) | Agency queue priority 0 runs first under slot pressure |
| **One nightly window** | reconciliation + inline rollback tests | Observe 04:00 UTC cron + warmup reconciliation | Pending drains; no unbounded `oldestQueuedAgeMs` |
| **Agency sale gate** | `tests/commercial-launch-gate.test.ts` | Code opens only after `fanout` + allowlist/global + internal secret | Prod stays **held** until live ladder completes |

**Simulated proof status (2026-06-24):** PASS — shadow, 75-job dispatch, mixed fleet ranking, slot drain, commercial gate holds, canary ladder evaluator.

**Live proof status:** NOT RUN — production remains `MONITORING_FANOUT_MODE=inline`.

## Activation ladder (not executed in dormant deploy)

1. **Shadow** on preview/staging — verify eligible counts only (`node scripts/monitoring-fanout-canary.mjs --step shadow --shadow-only N`)
2. **Fan-out + allowlist** — one internal workspace user ID, `MONITORING_FANOUT_MAX_INFLIGHT=1`, notifications disabled, single watchlist
3. **75-watchlist scheduling test** — allowlisted workspace only; validate with `--step fleet75 --remote`
4. **One full nightly window** + reconciliation warmup observation (`--step nightly --remote`)
5. **Pilot Agency allowlist** expansion
6. **`MONITORING_FANOUT_GLOBAL=1`** only after multiple clean windows

### Canary tooling (read-only)

```bash
# Dormant production config check (expects inline + internal secret in env)
MONITORING_FANOUT_MODE=inline \
MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID=1 \
node scripts/monitoring-fanout-canary.mjs --step config

# After a shadow cron window (pass shadowOnly count from logs)
node scripts/monitoring-fanout-canary.mjs --step shadow --shadow-only 3

# After allowlist pilot — read-only D1 metrics from production
node scripts/monitoring-fanout-canary.mjs --step allowlist --remote

# After 75-job proof
node scripts/monitoring-fanout-canary.mjs --step fleet75 --remote --json

# Offline evaluation from saved wrangler JSON
node scripts/monitoring-fanout-canary.mjs --step nightly --metrics-file ./tmp/fanout-metrics.json
```

The canary script never sets vars, triggers crons, or sends customer notifications. Coordinator merges `npm run canary:fanout` separately if desired.

## Rollback

Set `MONITORING_FANOUT_MODE=inline` and redeploy.

- Pending orchestrated runs cancelled on reconciliation when inline.
- Surviving Workflow instances exit at mode check (`fanout_disabled`) without scanning.
- Workflows already inside Browser Rendering may finish that browser operation; rollback is not instantaneous for in-flight browser work.

## Operator monitoring

- Logs: `monitoring_fanout_scheduled`, `monitoring_fanout_workflow_binding_missing`, `monitoring_fanout_dispatch_failed`, `monitoring fanout reconciliation completed`
- D1: `watchlist_run` status counts for `trigger_type='scheduled'`
- D1: `monitoring_concurrency_slot` holders

## Remaining runtime risks before broad Agency launch

- Live `createBatch` behavior and rate limits on the Cloudflare account
- Browser Rendering concurrent session ceiling vs `MONITORING_FANOUT_MAX_INFLIGHT`
- In-flight workflow drain latency after rollback
- Proof that 75 jobs complete across real nightly windows (not sqlite mocks alone)

## Plan-aware queue priority (2026-06-23, local only)

Branch `cursor/plan-entitlements-topups-no-prices-20260623` adds `watchlist_run.queue_priority` (migration `0052`) and persists plan-derived priority on orchestrated runs:

| Plan | Scheduled cadence | Queue priority (lower runs first) |
|------|-------------------|-----------------------------------|
| Agency | Daily | `0` |
| Starter | Daily | `1` |
| Scout | Monday only | `2` |

Top-up balance does **not** alter cadence or priority. Fan-out remains **dormant** (`MONITORING_FANOUT_MODE=inline`); priority fields are schema-ready for activation ladder above.

**Slot acquisition (final audit):** `claimMonitoringConcurrencySlot()` only succeeds when the run is within the top `MONITORING_FANOUT_MAX_INFLIGHT` ranked pending runs (`selectRankedEligibleOrchestratedRuns`). Ordering: effective priority (with 30-minute aging boosts), scheduled slot, `queued_at`, run id. A run cannot hold more than one slot simultaneously. Scout runs are excluded on non-Mondays.

## Agency sale verdict

**Recommendation: HOLD** until live ladder steps 1–4 complete.

- Code gate (`commercial-launch-gate.server.ts`) correctly holds Agency when `inline` or `shadow`.
- Simulated vitest proof is green; production has not run shadow/allowlist/75-job/nightly windows.
- Do not open Agency checkout or set `MONITORING_FANOUT_GLOBAL=1` until owner confirms live proof via canary `--remote` steps.
