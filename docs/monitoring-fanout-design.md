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
  → for each allowlisted eligible watchlist:
       ensure watchlist_run (pending, idempotency_key)
       MonitoringWorkflow.createBatch(id=derivedWorkflowId)
  → inline fallback for non-allowlisted workspaces when mode=fanout
  → exit (no Browser Rendering in cron)

MonitoringWorkflow instance
  → loop: claim D1 concurrency slot (atomic) or step.sleep
  → step: runWatchlistWorkflowJob
       claim run (processing_token)
       revalidate watchlist + plan + fanout mode
       run existing monitoring pipeline on pre-created runId
       renew leases during scan pages
       fenced finalize
  → release concurrency slot
```

### Idempotency

- **Logical scan key (D1):** `watchlist-run:{trigger}:{watchlistId}:{cron}:{scheduledSlot}` (`buildWatchlistExecutionIdempotencyKey`)
- **Workflow instance ID:** `monitor-v1-{sha256-base64url-prefix}` derived from the logical key (`buildMonitoringWorkflowInstanceId`) — valid for Cloudflare (`^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`, ≤100 chars)
- **Uniqueness:** partial unique index on `watchlist_run.idempotency_key` (0046) + idempotent `createBatch`
- **Manual refresh:** separate trigger type / no shared scheduled slot key

### State machine (`watchlist_run.status`)

| Status | Meaning |
|--------|---------|
| `pending` | Queued; dispatch may be pending or retrying |
| `running` | Claimed by a workflow consumer |
| `succeeded` / `failed` | Terminal scan outcomes (existing semantics) |
| `skipped` | Cancelled ineligible, rollback, or capacity/dispatch backlog (customer-safe messaging) |

Orchestration metadata (migration `0047`): `workflow_instance_id`, `processing_token`, `processing_started_at`, `queued_at`, `attempt_count`, `retry_after`.

Concurrency permits (migration `0048`): `monitoring_concurrency_slot` rows claimed atomically.

### Concurrency

- `MONITORING_FANOUT_MAX_INFLIGHT` (default **8**) — atomic D1 slot table, not a count-then-update race
- Workflow waits with `step.sleep` between claim attempts (does not consume step budget)
- Operator verifies against Browser Rendering plan limits before raising

### Rollout modes (`MONITORING_FANOUT_MODE`)

| Mode | Behavior |
|------|----------|
| `inline` | **Production default.** Rollback-only legacy sequential cron scans |
| `fanout` | Durable workflow fan-out for allowlisted workspaces (`MONITORING_FANOUT_ALLOWLIST` or `MONITORING_FANOUT_GLOBAL=1`) |
| `shadow` | Counts eligible watchlists only; no D1 runs, no workflows, no scans |

Missing workflow binding in `fanout` mode falls back to `inline` via `resolveMonitoringFanoutMode`.

## Operational costs / limits to verify on account

- Cloudflare Workflows instance count per nightly window (75+ per Agency workspace)
- Browser Rendering concurrent session limits
- Workers Paid plan required (already true for browser crons)
- Workflow `createBatch` rate limits (handled as retryable dispatch failures)

No Cloudflare resources were provisioned during this coding run.
