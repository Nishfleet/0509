# Monitoring Fan-Out Design

Date: 2026-06-23
Branch: `cursor/agency-monitoring-fanout-20260623`

## Present architecture (before this change)

1. **Cron** (`workers/app.ts` → `runScheduledMonitoring`) runs digests first, then loads all eligible watchlists via `listActiveWatchlists`.
2. When Browser Rendering is the commercial provider, `shouldRunScheduledMonitoringInline()` forced the **inline** path even though `MONITORING_WORKFLOW` is configured in `wrangler.jsonc`.
3. Inline path scans sequentially inside the cron invocation with a **12-minute** budget (`SCHEDULED_MONITORING_TIME_BUDGET_MS`). Remaining watchlists get `recordWatchlistCapacitySkip` rows (`capacity_budget`).
4. Non-browser paths could queue `MonitoringWorkflow.create()` per watchlist, but workflow create failures fell back to inline scans.
5. Each workflow instance runs a single `runWatchlistWorkflowJob` step today; browser work happens inside that job.
6. `watchlist_run` rows are created at scan start (`createWatchlistRun`), not at schedule time. Capacity skips use `idempotency_key` (migration `0046`).

### Why Browser Rendering bypassed Workflow

Historical comment in `monitoring.server.ts` assumed browser-backed discovery required the cron Worker runtime. `MonitoringWorkflow` is a Worker entrypoint with the same bindings (including `BROWSER`). The bypass was a product/runtime shortcut, not a platform limitation.

### Failure modes addressed

| Failure | Old behavior | New behavior |
|---------|--------------|--------------|
| Cron time budget | Later watchlists skipped with capacity_budget | All eligible watchlists durably queued |
| One slow watchlist | Blocks inline loop | Isolated workflow instance |
| Workflow create failure | Inline browser fallback | Durable pending run + reconciliation retry |
| Duplicate cron | Partial protection via workflow ID | DB uniqueness on `idempotency_key` + workflow ID |
| Crash mid-scan | In-flight run may stall | Lease + reconciliation reclaim |
| Stale processor | Could overwrite newer attempt | `processing_token` fencing on finalize |

## Chosen architecture

**Reuse `MonitoringWorkflow`** — one durable instance per logical scheduled watchlist scan.

Rejected for this slice:

- **Cloudflare Queues** — Workflow already provides per-job durability, retries, and deterministic instance IDs; adding Queues would duplicate orchestration without clear benefit.
- **Single workflow with 75 sequential steps** — violates independent retry/failure isolation requirements.

## New flow

```
Cron (orchestrator only)
  → digests (unchanged, still first)
  → reconcile stale queued/running runs (bounded)
  → for each eligible watchlist:
       ensure watchlist_run (pending, idempotency_key)
       MonitoringWorkflow.create(id=executionKey)
  → exit (no Browser Rendering in cron)

MonitoringWorkflow instance
  → step: acquire concurrency slot (bounded, retried)
  → step: runWatchlistWorkflowJob
       claim run (processing_token)
       revalidate watchlist + plan
       run existing monitoring pipeline on pre-created runId
       fenced finalize
```

### Idempotency

- **Logical scan key:** `watchlist-run:{trigger}:{watchlistId}:{cron}:{scheduledSlot}` (`buildWatchlistExecutionIdempotencyKey`)
- **Uniqueness:** partial unique index on `watchlist_run.idempotency_key` (0046) + workflow instance ID
- **Manual refresh:** separate trigger type / no shared scheduled slot key

### State machine (`watchlist_run.status`)

| Status | Meaning |
|--------|---------|
| `pending` | Queued; dispatch may be pending or retrying |
| `running` | Claimed by a workflow consumer |
| `succeeded` / `failed` | Terminal scan outcomes (existing semantics) |
| `skipped` | Cancelled ineligible or capacity/dispatch backlog (customer-safe messaging) |

Orchestration metadata (migration `0047`): `workflow_instance_id`, `processing_token`, `processing_started_at`, `queued_at`, `attempt_count`, `retry_after`.

### Concurrency

- `MONITORING_FANOUT_MAX_INFLIGHT` (default **8**) — not simultaneous browser sessions for all 75 jobs; caps active `running` scheduled runs.
- Workflow first step waits/retries when at cap.
- Operator verifies against Browser Rendering plan limits before raising.

### Rollout modes (`MONITORING_FANOUT_MODE`)

| Mode | Behavior |
|------|----------|
| `fanout` | Default when workflow binding exists |
| `inline` | Rollback-only legacy sequential cron scans |
| `shadow` | Creates durable schedule records without executing scans |

Missing workflow binding in `fanout` mode falls back to `inline` via `resolveMonitoringFanoutMode`.

## Operational costs / limits to verify on account

- Cloudflare Workflows instance count per nightly window (75+ per Agency workspace)
- Browser Rendering concurrent session limits
- Workers Paid plan required (already true for browser crons)
- Workflow step retries (concurrency wait uses exponential backoff)

No Cloudflare resources were provisioned during this coding run.
