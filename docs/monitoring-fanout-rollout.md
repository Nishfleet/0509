# Monitoring Fan-Out Rollout Runbook

**Status:** FIXED-CANDIDATE/LIVE CONFIG RECORD — dated dispatch proof only; current Gate A–C release readiness is 0/6 with all six journeys active and four frozen candidates blocked. Agency checkout is open with `MONITORING_FANOUT_MODE=fanout` and `MONITORING_FANOUT_GLOBAL=1`, but the current all-six candidate/review/Gate C and real scan health still require refresh.

## Production reality after global fan-out deploy

- Fan-out **behavior was active in the dated production proof** after the 2026-06-28 internal Agency-scale dispatch proof; verify current runtime/config before treating this as current Gate B/C evidence.
- `MONITORING_FANOUT_MODE=fanout` is the production default.
- `MONITORING_FANOUT_GLOBAL=1` is enabled; do not set `MONITORING_FANOUT_ALLOWLIST=*`.
- Synthetic proof watchlists were deactivated after proof, and the internal owner plan was restored.
- Migrations `0047` and `0048` are additive schema only; they do not activate fan-out.

## Prerequisites

- Migrations `0047_monitoring_fanout_orchestration.sql` and `0048_monitoring_concurrency_slots.sql` applied **before** Worker deploy
- Existing `MONITORING_WORKFLOW` binding in `wrangler.jsonc`
- `MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID` secret configured (internal pilot workspace; never commit a value)
- No Cloudflare Queue provisioning required

## Configuration (`wrangler.jsonc` vars)

| Var | Production default | Purpose |
|-----|-------------------|---------|
| `MONITORING_FANOUT_MODE` | `fanout` | `inline` / `fanout` / `shadow` |
| `MONITORING_FANOUT_ALLOWLIST` | unset | Optional comma-separated workspace user IDs for scoped pilots; never `*` |
| `MONITORING_FANOUT_GLOBAL` | `1` | Enables all eligible workspaces after owner-approved dispatch proof |
| `MONITORING_FANOUT_MAX_INFLIGHT` | `8` | Clamped to `64` (`MONITORING_CONCURRENCY_SLOT_CAPACITY`) |
| `MONITORING_ORCHESTRATION_LEASE_MS` | `3600000` (60 min) | Lease margin around the 30 min Workflow scan step cap and reconciliation |
| `MONITORING_CONCURRENCY_SLOT_LEASE_MS` | `3600000` (60 min) | Aligned with orchestration lease |

## Architecture summary

- **Logical key (D1):** `watchlist-run:{trigger}:{watchlistId}:{cron}:{slot}`
- **Workflow instance ID:** `monitor-v1-{sha256-base64url}` (≤100 chars, Cloudflare-valid)
- **Dispatch:** `MONITORING_WORKFLOW.createBatch()` (idempotent on duplicate IDs)
- **Concurrency:** atomic `monitoring_concurrency_slot` claims (64 seeded rows)
- **Missing binding:** explicit fan-out records `workflow_binding_missing`, does **not** inline-scan
- **Shadow:** counts eligible watchlists only; no D1 runs, no workflows, no deliveries

## Schema-first deployment order (historical procedure; verify current ledger first)

1. `npx wrangler d1 migrations list 0509 --remote` — confirm the current pending set; the `0047`/`0048` expectation applies only to the historical rollout.
2. `npx wrangler d1 migrations apply 0509 --remote`
3. Confirm `No migrations to apply`
4. `npm run deploy` with `MONITORING_FANOUT_MODE=fanout` and `MONITORING_FANOUT_GLOBAL=1` after live dispatch proof
5. Post-deploy health checks (home, `/api/health`, auth, Dodo webhook route)

## Proof matrix: simulated vs live

| Ladder step | Simulated (vitest) | Live (owner) | Pass criteria |
|-------------|-------------------|--------------|---------------|
| **Config** | `tests/monitoring-fanout-canary.test.ts` | `node scripts/monitoring-fanout-canary.mjs --step config` | `fanout` default; internal workspace secret set; `GLOBAL=1` |
| **Shadow** | `tests/monitoring-fanout.test.ts` shadow mode | Set `MONITORING_FANOUT_MODE=shadow`, observe one cron window | `shadowOnly > 0`; zero `watchlist_run` rows; no deliveries |
| **Allowlist (1 watchlist)** | dispatch + binding-missing tests | `fanout` + allowlist internal user ID, `MAX_INFLIGHT=1`, notifications off | Exactly one queued/dispatched run; `dispatchFailures = 0` |
| **75-job fleet** | `schedules 75 eligible watchlists` | Internal workspace with 75 active agency watchlists | `queued >= 75`; `dispatchFailures = 0`; slots ≤ `MAX_INFLIGHT` |
| **Mixed 75/10/3 fleet** | `monitoring-queue-priority` + mixed scheduling test | Optional stress on internal workspace (Monday window for scout) | Agency queue priority 0 runs first under slot pressure |
| **One nightly window** | reconciliation + inline rollback tests | Observe 04:00 UTC cron + warmup reconciliation | Pending drains; no unbounded `oldestQueuedAgeMs` |
| **Agency sale gate** | `tests/commercial-launch-gate.test.ts` | Code opens only after `fanout` + allowlist/global + internal secret | Prod opens once live fan-out dispatch proof passes |

**Simulated proof status (2026-06-24, historical):** PASS — shadow, 75-job dispatch, mixed fleet ranking, slot drain, commercial gate holds, canary ladder evaluator.

**Live proof status (2026-06-28, historical fixed-candidate evidence):** PASS for dispatch — production cron queued 78 fan-out jobs for the internal Agency-scale proof workspace with 0 dispatch failures and 8 max concurrency slots. Synthetic proof watchlists were deactivated after proof to avoid recurring fake-target scan failures. This did not prove real customer-quality scan completion.

## Activation ladder

1. **Shadow** on preview/staging — verify eligible counts only (`node scripts/monitoring-fanout-canary.mjs --step shadow --shadow-only N`)
2. **Fan-out + allowlist** — one internal workspace user ID, `MONITORING_FANOUT_MAX_INFLIGHT=1`, notifications disabled, single watchlist
3. **75-watchlist scheduling test** — allowlisted workspace only; validate with `--step fleet75 --remote`
4. **One full nightly window** + reconciliation warmup observation (`--step nightly --remote`)
5. **Pilot Agency allowlist** expansion
6. **`MONITORING_FANOUT_GLOBAL=1`** after owner-approved dispatch proof — completed 2026-06-28 in the dated proof; keep monitoring scan completion and dispatch failures after each nightly window

### Canary tooling (read-only)

```bash
# Production config check (expects fanout + global + internal secret)
MONITORING_FANOUT_MODE=fanout \
MONITORING_FANOUT_GLOBAL=1 \
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

## Runtime watch items after broad Agency launch

- Browser Rendering concurrent session ceiling vs `MONITORING_FANOUT_MAX_INFLIGHT`
- In-flight workflow drain latency after rollback
- The workflow scan step is capped at 30 minutes to stay within Cloudflare Workflows step limits
- Current Gate C proof that an operator-owned internal watchlist completes across nightly windows, not just dispatches successfully; target-buyer usefulness remains Gate D

## Plan-aware queue priority (2026-06-23, local only)

Branch `cursor/plan-entitlements-topups-no-prices-20260623` adds `watchlist_run.queue_priority` (migration `0052`) and persists plan-derived priority on orchestrated runs:

| Plan | Scheduled cadence | Queue priority (lower runs first) |
|------|-------------------|-----------------------------------|
| Agency | Every 3 hours | `0` |
| Starter | Every 3 hours | `1` |
| Scout | Every 6 hours | `2` |

Top-up balance does **not** alter cadence or priority. Fan-out is globally enabled after the 2026-06-28 internal dispatch proof; priority fields govern the live workflow queue.

**Slot acquisition (final audit):** `claimMonitoringConcurrencySlot()` only succeeds when the run is within the top `MONITORING_FANOUT_MAX_INFLIGHT` ranked pending runs (`selectRankedEligibleOrchestratedRuns`). Ordering: effective priority (with 30-minute aging boosts), scheduled slot, `queued_at`, run id. A run cannot hold more than one slot simultaneously. Scout runs are excluded on non-Mondays.

## Agency sale verdict

**Historical recommendation: OPEN with monitoring** after the 2026-06-28 live dispatch proof. Current Agency release readiness is 0/6 with the other journeys: a current Gate B/C claim still requires candidate-bound runtime evidence and an operator-owned internal scan tied to the deployed version/config.

- Code gate (`commercial-launch-gate.server.ts`) correctly holds Agency when `inline` or `shadow`.
- Simulated vitest proof was green; production dispatched an Agency-scale internal proof through Workflow fan-out in the dated run.
- Keep `MONITORING_FANOUT_GLOBAL=1` only while scheduled dispatch failures stay at zero and operator-owned internal scan failures remain explainable. Do not use customer data to prove the engineering gate.

## Measured watchlist scheduling ceiling (2026-09-11, 0509#2990)

Earlier drafts inferred a "practical ceiling in the low hundreds". That inference is
replaced by a deterministic measurement against the real committed
constants: `npm run test:presence-load` models the fan-out scheduler with the
committed `MONITORING_FANOUT_MAX_INFLIGHT=8`, the paid cadence (agency/starter
tick every 3 hours), and the worst-case per-run scan duration (30-minute
`MONITORING_WORKFLOW_SCAN_TIMEOUT_MS` cap). Output:

```
npm run test:presence-load
watchlist ceiling (inflight=8, cadence=180min, worst-run=30min):
  keeps pace at up to 48 watchlists fleet-wide
  slips <=1 cadence up to 96 watchlists fleet-wide (canary alert threshold)
  > 96 watchlists: schedule falls more than one cadence behind
agency workspace (priorityScanSlots=25; ranks beyond run on 6h-aligned ticks only):
  keeps pace at up to 71 watchlists/workspace worst-case
  the promised 75 demands 100 runs/6h vs 96 worst-case capacity
```

- **48 active paid watchlists fleet-wide** is the throughput bound that keeps
  every scheduled run dispatched before the next cadence window, even if every
  run consumes its full 30-minute scan cap. The 8 in-flight slots are shared
  across all workspaces — this is a fleet number, not a per-workspace number.
- **96** is the published slip allowance: with one full cadence of accumulated
  slip the schedule still drains.
- **Agency's promised 75 watchlists/workspace** is a split cadence, not a flat
  3h one: only the first `priorityScanSlots=25` watchlists run on every 3h
  tick, ranks 26–75 run only on 6h-aligned ticks
  (`shouldScheduleWatchlistInRegularScan`, plan-entitlements). One fully-loaded
  Agency workspace therefore demands **100 runs per 6h** against a worst-case
  capacity of **96** — 4 runs over the bound. In practice scans finish far
  under the 30-minute cap, so the promise holds on average; under sustained
  worst-case scans a single maxed Agency workspace alone slips ~30 minutes
  behind per 6h window until inflight rises.
- What to do before promising more than 71/workspace or 48 fleet-wide: raise
  `MONITORING_FANOUT_MAX_INFLIGHT` (slot capacity is 64) and re-measure with
  `MONITORING_FANOUT_MAX_INFLIGHT=16 npm run test:presence-load` — each doubling
  of inflight doubles the ceiling at the same cadence and scan cap.
- If real scans complete well under the 30-minute cap in production, re-run the
  simulation with `MONITORING_CADENCE_MINUTES` unchanged and a smaller worst-run
  constant in `scripts/presence-load-test.mjs`; the published numbers scale as
  `inflight * floor(2 * cadence / worst_run)`.

### Schedule-slip canary

`node scripts/monitoring-fanout-canary.mjs --step cadence [--cadence-hours 3]`
alerts when the oldest queued scheduled run has been waiting more than one
cadence beyond its due window (`schedule_slipped_more_than_one_cadence`), and
warns once it is past one cadence. Read queue age via `--remote` (D1
`MIN(queued_at)` over pending scheduled runs) or `--metrics-file`. Wire it into
the scheduled canary runbook next to `--step nightly` so a slipped schedule is
noticed before Agency customers do.
