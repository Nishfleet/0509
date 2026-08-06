# GA Metrics

Uses the **approved in-repo mechanism only**: structured JSON logs via `app/lib/log.server.ts` (Cloudflare Workers observability). No third-party analytics SDK added for GA launch.

## Log operations to monitor

| Operation | Meaning |
|-----------|---------|
| `monitoring_fanout_scheduled` | Fan-out dispatch batch |
| `monitoring_fanout_workflow_binding_missing` | Workflow binding absent |
| `monitoring_fanout_dispatch_failed` | Workflow create failed |
| `dodo_webhook_*` | Billing event processing |
| `delivery_*` | Email send attempts; dormant Slack/WhatsApp attempts only if an operator deliberately tests non-GA channels |

## Business metrics (operator queries — D1)

Run on production D1 read-only; do not export PII to docs.

| Metric | Source |
|--------|--------|
| New signups / day | `user` created_at |
| Paid conversions | `user_plan` where plan != free |
| Active watchlists | `watchlist` where paused_at IS NULL |
| Evidence usage | `evidence_usage_period` |
| Top-up revenue events | `evidence_top_up_grant` |
| Churn signals | `user_plan.dodo_status` failed/on_hold/cancelled |

## Launch funnel (manual)

1. Homepage → signup (no automated funnel — infer from auth tables).
2. Signup → first watchlist (`workspace readiness` items).
3. First watchlist → first successful proof (`proof_capture` stats).
4. Free → paid (`user_plan` transitions).

## Funnel measurement status

Specification only: see [docs/funnel-measurement-spec.md](./funnel-measurement-spec.md).
The funnel remains manual with no automated collection until the rollout gates in that
spec pass. No event logging or instrumentation is enabled by the spec itself.

## Canary metrics (private)

- `npm run canary:prod` — JSON report via `CANARY_BYPASS_TOKEN`
- `npm run canary:billing` — webhook grant path
- `npm run canary:proof` — fresh proof + delivery

## Future (owner decision)

- Cloudflare Logpush → warehouse
- UptimeRobot SLA on `/api/health`

Do not add client-side tracking pixels without explicit owner approval.
