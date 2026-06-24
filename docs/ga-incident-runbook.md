# GA Incident Runbook

## Severity levels

| Level | Definition | Example |
|-------|------------|---------|
| S1 | Core down or billing broken | Health 5xx, webhooks failing grants |
| S2 | Degraded monitoring/delivery | Cron skips, email backlog |
| S3 | Single-customer issue | One watchlist stuck |

## First response (all levels)

1. Check `https://0509.io/api/health`.
2. Cloudflare Workers dashboard → 0509 Worker → recent errors.
3. Structured logs: search `operation` field (`monitoring_fanout_*`, `dodo_webhook_*`, `delivery_*`).

## S1 — Core outage

1. Confirm custom domains and Worker deployment version.
2. If deploy-related: set `MONITORING_FANOUT_MODE=inline` and redeploy if fan-out suspected.
3. D1: `wrangler d1 migrations list 0509 --remote` — schema drift blocks writes.
4. Communicate on `/status` copy update (manual deploy) if extended.

## S1 — Billing / webhooks

1. Verify Dodo webhook endpoint receives events (Dodo dashboard delivery log).
2. Check `dodo_webhook_event` for stuck `processing` (5-minute lease reclaim).
3. **Never** replay webhooks with real grants without idempotency review.
4. Run `npm run canary:billing` from operator machine (test user only).

## S2 — Monitoring capacity

1. Check `watchlist_run` with `error_code = capacity_budget`.
2. Confirm `MONITORING_FANOUT_MODE` — inline has ~12 min global budget.
3. Agency customers may see "Delayed — capacity limit" until fan-out active.

## S2 — Email delivery

1. Cloudflare Email Service Activity log (dashboard).
2. `delivery_attempt` table for `provider = cloudflare_email`.
3. No in-app bounce webhooks — manual list hygiene if needed.

## Rollback

```bash
# Safe rollback to inline monitoring (no history rewrite)
# Set MONITORING_FANOUT_MODE=inline in wrangler.jsonc vars, then:
npm run deploy
```

## Post-incident

1. Update `docs/ga-launch-scorecard.md` if commercial gates affected.
2. File support cases for affected customers if data/delay impact.

## Contacts

- Operator: Nish (`me@inish.in` launch canary email in wrangler vars)
- Support customers: `support@0509.io`
