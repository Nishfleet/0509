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
| `funnel_home_view` | Anonymous homepage view (v1 funnel event, see below) |
| `funnel_search_preview_submit` | Anonymous public search preview submit (v1 funnel event) |
| `funnel_search_preview_result` | Anonymous public search preview with results (coarse count bucket only) |
| `funnel_search_preview_error` | Anonymous public search preview failure (coarse error kind only) |
| `funnel_signup_start` | Anonymous signup start (magic link send or OAuth provider choice) |

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

The v1 anonymous funnel events are **implemented but default-off**. See
[docs/funnel-measurement-spec.md](./funnel-measurement-spec.md) for the event
table, field allowlist, and rollout gates. Shipped behavior, exactly:

- **No collection by default.** The code path exists (`app/lib/funnel-measurement.server.ts`,
  route-boundary calls in `marketing.tsx`, `search.tsx`, `auth.signup.tsx`,
  `auth.better.oauth.ts`) but emits nothing unless the server-side variable
  `FUNNEL_MEASUREMENT_ENABLED` is set to exactly `true`. Absent, empty, or any
  other value (including `1`, `yes`, `on`) stays disabled, so an absent
  environment variable can never turn collection on. **This variable is not set
  in any environment, including production.**
- **GPC suppressed.** Every request carrying `Sec-GPC: 1` is treated as opted
  out and produces no funnel event. DNT is not treated as an opt-out.
- **Anonymous and request-scoped only.** Events carry only server-generated
  fields: `event_id`, server `timestamp`, fixed `route` (`home`, `search_preview`,
  `signup`), `account_scope: "anonymous"`, plus `result_count_bucket`
  (`0`, `1-10`, `11-50`, `51+`) or `error_kind` (coarse classes only). No query
  text, email, name, URL, referrer, IP, user agent, cookie, or join key is ever
  written. Search events fire only for signed-out visitors; signed-in search is
  not funnel traffic. Ad-selection reruns and pagination do not re-count submits;
  HEAD crawl probes emit nothing.
- **Still gated.** The spec's rollout gates remain unpassed: legal review,
  owner-approved retention period (the 90-day candidate is not settled),
  policy-surface parity on the privacy/terms pages, retention/delete tests, and
  the post-enable canary. Until those pass, `FUNNEL_MEASUREMENT_ENABLED` must
  stay unset and **no live numbers exist to report**.
- **No new storage.** Anonymous events are structured JSON log records only.
  Activation measures are derived read-only from existing D1 tables (below) and
  are never emitted as events or dual-logged.

### Daily aggregate questions (operator, read-only)

**Anonymous event counts** (from Cloudflare Workers observability / Logpush,
`operation = "funnel_*"`): daily counts of each `funnel_*` operation, and ratios
such as `funnel_search_preview_result` (bucket `!= "0"`) vs
`funnel_search_preview_error` per day. No raw event export: aggregate only, and
drop any result cell below a minimum count before it appears in a deliverable.

**Activation measures** (read-only aggregates over existing D1 tables; same
semantics as the manual funnel below — these are populations, never joined to
anonymous events, and v1 cannot measure same-visitor progression):

```sql
-- Signup completion per day (activation step 0)
SELECT date(created_at) AS day, count(*) FROM user GROUP BY day;
-- First watchlist per workspace (activation step 1)
SELECT w.workspace_id, min(w.created_at) FROM watchlist w GROUP BY w.workspace_id;
-- First proof per workspace (activation step 2)
SELECT p.workspace_id, min(p.created_at) FROM proof_capture p GROUP BY p.workspace_id;
-- Free -> paid transitions (reconcile against user_plan; never payment data)
SELECT date(updated_at) AS day, count(*) FROM user_plan
WHERE plan != 'free' GROUP BY day;
```

Run these read-only against production D1. No credentials in queries or outputs;
do not export PII to docs. Retention: anonymous events follow the spec's
bounded-retention rule once a period is owner-approved; derived measures leave
no separate stored copy to clean up on account deletion.

## Canary metrics (private)

- `npm run canary:prod` — JSON report via `CANARY_BYPASS_TOKEN`
- `npm run canary:billing` — webhook grant path
- `npm run canary:proof` — fresh proof + delivery

## Future (owner decision)

- Cloudflare Logpush → warehouse
- UptimeRobot SLA on `/api/health`

Do not add client-side tracking pixels without explicit owner approval.
