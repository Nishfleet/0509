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

First-party anonymous funnel events are **shipped but disabled by default**:
see [docs/funnel-measurement-spec.md](./funnel-measurement-spec.md) and the
implementation in `app/lib/funnel-measurement.server.ts`.

### Shipped behavior (no collection enabled)

- Default-off: events are emitted only when `FUNNEL_MEASUREMENT_ENABLED` is
  explicitly set to a truthy value (`1`/`true`/`yes`/`on`). Absent, empty, or
  any other value keeps collection off. This variable is not set in
  production.
- Request-scoped anonymous events only, written through the approved structured
  JSON log mechanism (`app/lib/log.server.ts`) with `funnel_*` operations:
  `funnel_home_view`, `funnel_search_preview_submit`,
  `funnel_search_preview_result`, `funnel_search_preview_error`,
  `funnel_signup_start`. Fields are limited to the spec's allowlist
  (`route`, server `event_id`, server `timestamp`, coarse
  `result_count_bucket`, coarse `error_kind`, `account_scope: anonymous`).
- GPC (`Sec-GPC: 1` / `GPC: 1`) suppresses every event. DNT is not treated as
  an opt-out. Signed-in search activity emits nothing (the funnel is
  anonymous-only).
- No cookies, localStorage, visitor/session ids, IP, UA, referrer, query text,
  or any client-supplied value ever enters an event.

### Remaining gates (all unpassed — no production collection)

- Legal/privacy review is not complete.
- The final retention period is not owner-approved.
- Owner approval to enable collection is not granted.
- Policy-surface parity review (privacy/terms copy) has not shipped.

Production collection starts only when the operator sets
`FUNNEL_MEASUREMENT_ENABLED` **and** the gates above pass.

### Operator readout

`/api/funnel-measurement` (canary-token-gated like `/api/launch-readiness`):
- Reports the runtime gate truth: `collection` (`enabled`/`disabled`),
  `eventNames`, `gates` (all reported as unpassed today).
- Reports read-only daily aggregate counts of the derived activation measures
  (`dailyDerivedMetrics`: signup completions, first watchlists, first proofs)
  counted directly off existing D1 business tables (`user`, `watchlist`,
  `proof_capture`) — never logged as events, never stored separately.
- Anonymous event counts are **not** queryable from the worker runtime: those
  events live only in structured JSON logs (Cloudflare Workers observability).
  `days` is clamped to 1–30 (default 14).


## Canary metrics (private)

- `npm run canary:prod` — JSON report via `CANARY_BYPASS_TOKEN`
- `npm run canary:billing` — webhook grant path
- `npm run canary:proof` — fresh proof + delivery

## Future (owner decision)

- Cloudflare Logpush → warehouse
- UptimeRobot SLA on `/api/health`

Do not add client-side tracking pixels without explicit owner approval.
