# Monitoring Fan-Out Rollout Runbook

**Status:** CODE READY — NOT DEPLOYED IN THIS RUN

## Prerequisites

- Migration `0047_monitoring_fanout_orchestration.sql` applied after deploy
- Existing `MONITORING_WORKFLOW` binding in `wrangler.jsonc` (already present)
- No new Queue provisioning required

## Configuration (`wrangler.jsonc` vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `MONITORING_FANOUT_MODE` | `fanout` | `fanout` / `inline` / `shadow` |
| `MONITORING_FANOUT_MAX_INFLIGHT` | `8` | Max concurrent scheduled `running` scans |
| `MONITORING_ORCHESTRATION_LEASE_MS` | `900000` (15 min) | Stale run reclaim window |

Verify Browser Rendering session limits before increasing `MONITORING_FANOUT_MAX_INFLIGHT`.

## Deployment order

1. Apply migration `0047` remotely (`npx wrangler d1 migrations apply 0509 --remote`)
2. Deploy Worker with fan-out code (mode can stay `fanout` — conservative concurrency default)
3. Observe one nightly window with structured logs: `monitoring_fanout_scheduled`, `monitoring fanout reconciliation completed`
4. Internal canary: single Agency workspace, confirm pending → running → succeeded without duplicate `delivery_attempt` rows
5. Controlled 75-watchlist scheduling test in staging/shadow (`MONITORING_FANOUT_MODE=shadow` first if desired)
6. Pilot Agency accounts; watch oldest queued age metrics
7. Keep `inline` documented for rollback

## Rollback

Set `MONITORING_FANOUT_MODE=inline` and redeploy. Existing pending orchestrated runs reconcile/cancel over subsequent warmups; no down migration.

## Monitoring queries (operator)

- Log filter: `monitoring_fanout_scheduled`, `monitoring_fanout_dispatch_failed`, `monitoring fanout reconciliation completed`
- D1: counts of `watchlist_run` by `status` for `trigger_type='scheduled'` in last 48h
- Alert if `dispatchFailures` > 0 across multiple nights or oldest queued age > 6 hours

## What this run did **not** do

- No production deploy
- No remote D1 migration apply
- No Queue creation
- No live Browser Rendering or customer delivery tests
