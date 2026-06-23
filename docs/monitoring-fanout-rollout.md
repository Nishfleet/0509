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

## Activation ladder (not executed in dormant deploy)

1. **Shadow** on preview/staging — verify eligible counts only
2. **Fan-out + allowlist** — one internal workspace user ID, `MONITORING_FANOUT_MAX_INFLIGHT=1`, notifications disabled, single watchlist
3. **75-watchlist scheduling test** — allowlisted workspace only, mocked/browser-disabled validation preferred first
4. **One full nightly window** + reconciliation warmup observation
5. **Pilot Agency allowlist** expansion
6. **`MONITORING_FANOUT_GLOBAL=1`** only after multiple clean windows

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
