# Monitoring Fan-Out Rollout Runbook

**Status:** CODE READY — NOT DEPLOYED IN THIS RUN

## Prerequisites

- Migrations `0047_monitoring_fanout_orchestration.sql` and `0048_monitoring_concurrency_slots.sql` applied after deploy
- Existing `MONITORING_WORKFLOW` binding in `wrangler.jsonc` (already present)
- No new Queue provisioning required

## Configuration (`wrangler.jsonc` vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `MONITORING_FANOUT_MODE` | `inline` | `inline` / `fanout` / `shadow` |
| `MONITORING_FANOUT_ALLOWLIST` | unset | Comma-separated workspace user IDs, or `*` |
| `MONITORING_FANOUT_GLOBAL` | unset | Set `1` only after pilot proof to enable all workspaces |
| `MONITORING_FANOUT_MAX_INFLIGHT` | `8` | Max concurrent D1 concurrency slots |
| `MONITORING_ORCHESTRATION_LEASE_MS` | `2700000` (45 min) | Stale run reclaim window |
| `MONITORING_CONCURRENCY_SLOT_LEASE_MS` | `2700000` (45 min) | Slot reclaim + scan heartbeat window |

Verify Browser Rendering session limits before increasing `MONITORING_FANOUT_MAX_INFLIGHT`.

## Deployment order

1. Apply migrations `0047` and `0048` remotely (`npx wrangler d1 migrations apply 0509 --remote`)
2. Deploy Worker with `MONITORING_FANOUT_MODE=inline` (safe default — no behavior change)
3. Set `MONITORING_FANOUT_MODE=shadow` on preview/staging; confirm eligible counts in logs
4. Enable `MONITORING_FANOUT_MODE=fanout` + `MONITORING_FANOUT_ALLOWLIST=<internal-user-id>` for one internal workspace
5. Observe pending → running → succeeded; confirm no duplicate `delivery_attempt` rows
6. Controlled 75-watchlist scheduling test for the allowlisted workspace
7. Expand allowlist to pilot Agency accounts
8. After multiple clean nightly windows, set `MONITORING_FANOUT_GLOBAL=1` if desired

## Rollback

Set `MONITORING_FANOUT_MODE=inline` and redeploy immediately.

**Existing workflow instances:** running instances check mode at job start and cancel safely (`fanout_disabled`). Pending D1 rows are cancelled on the next reconciliation/warmup pass. Inline cron skips watchlists with active orchestrated pending/running rows for the same logical slot.

Do not expect rollback to instantly terminate in-flight Cloudflare Workflow executions — they exit at the next mode check without scanning.

## Monitoring queries (operator)

- Log filter: `monitoring_fanout_scheduled`, `monitoring_fanout_dispatch_failed`, `monitoring fanout reconciliation completed`
- D1: counts of `watchlist_run` by `status` for `trigger_type='scheduled'` in last 48h
- D1: `monitoring_concurrency_slot` rows with non-null `holder_run_id`
- Alert if `dispatchFailures` > 0 across multiple nights or oldest queued age > 6 hours

## What this run did **not** do

- No production deploy
- No remote D1 migration apply
- No Queue creation
- No live Browser Rendering or customer delivery tests
