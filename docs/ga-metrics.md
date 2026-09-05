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
| `funnel_*` | First-party funnel events (see below). Dormant: not emitted in any environment today |

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

Dormant code shipped (2026-08-07). `app/lib/funnel-measurement.server.ts` can emit
the spec's five anonymous events — `funnel_home_view` (homepage render),
`funnel_search_preview_submit` / `funnel_search_preview_result` /
`funnel_search_preview_error` (public search preview), `funnel_signup_start`
(magic-link or OAuth signup start) — as structured JSON log records via
`app/lib/log.server.ts`. Every record carries only allowlisted fields: the
event name as `operation`, a server-generated `eventId`, a server `timestamp`,
and `details.route` (`home` | `search_preview` | `signup`) plus coarse
`result_count_bucket` (`0` | `1-10` | `11-50` | `51+`) or `error_kind`
(`rate_limited` | `timeout` | `provider_unavailable` | `unknown`). No query
text, email, URL, IP, or any join key can reach a record; malformed or
tampered inputs are dropped, not written.

**Collection is off in every environment.** It would require
`FUNNEL_MEASUREMENT_ENABLED=true` (exact value; absent or anything else keeps
it off) **and** all rollout gates in
[docs/funnel-measurement-spec.md](./funnel-measurement-spec.md) §8 to pass —
legal review, owner approval of the retention period, and privacy/terms page
parity — none of which have passed. No production funnel numbers exist, and
none are claimed here. Requests carrying Global Privacy Control
(`Sec-GPC: 1`) are always suppressed. Homepage, search, and signup behavior is
identical with measurement disabled.

Operator readout (no storage invented, no raw export): `npm run funnel:aggregate`
runs `scripts/funnel-aggregate.mjs`, a read-only aggregator over captured
structured JSON log lines (stdin or a file) that prints the spec's daily
counts and bucket/kind breakdowns. It never prints raw event values.

## Canary metrics (private)

- `npm run canary:prod` — JSON report via `CANARY_BYPASS_TOKEN`
- `npm run canary:billing` — webhook grant path
- `npm run canary:proof` — fresh proof + delivery

## Future (owner decision)

- Cloudflare Logpush → warehouse
- UptimeRobot SLA on `/api/health`

Do not add client-side tracking pixels without explicit owner approval.
