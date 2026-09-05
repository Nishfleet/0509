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

**Not live — implementation present, default-off.** The contract is
[docs/funnel-measurement-spec.md](./funnel-measurement-spec.md); its §8 rollout
gates are all still unpassed (legal review, owner approval of the retention
period, a separate legal-copy change to the privacy/terms pages, and a
post-enable canary). No production environment sets the enable flag, so no
collection happens on the live site.

What ships in this increment:

- `app/lib/funnel-measurement.server.ts` — the only entry point for v1 funnel
  events. Writes to the same structured-log stream as operational logs
  (`app/lib/log.server.ts`); no new storage, table, migration, or provider
  change exists.
- Route-boundary calls: `app/routes/marketing.tsx` (homepage view),
  `app/routes/search.tsx` (anonymous preview submit/result/error), and
  `app/routes/auth.signup.tsx` (signup start).
- Events are written only when `FUNNEL_MEASUREMENT_ENABLED` is exactly `1`
  (absent or any other value = off) and the request carries no GPC opt-out
  (`Sec-GPC: 1` or `GPC: 1`). A request with a GPC signal is treated as opted
  out and records nothing.

Event contract (spec §3–§4): `funnel_home_view`, `funnel_search_preview_submit`,
`funnel_search_preview_result` (bucket `0` / `1-10` / `11-50` / `51+`),
`funnel_search_preview_error` (kind from a fixed allowlist), and
`funnel_signup_start`. Every record carries only server-generated fields:
`event_id` (UUID), server `timestamp`, `route` (coarse label), `account_scope:
"anonymous"`, and the coarse bucket/kind where the event table requires it. No
query text, URLs, emails, IPs, headers, or join keys — anonymous events are
request-scoped and cannot be joined to each other or to an account. Signup start
is counted once per anonymous signup-page render; the post-submit confirmation
render (`?sent=1`) is not a new start. Signed-in search requests emit nothing.

## Operator aggregate query (read-only, local)

Funnel events are structured JSON lines (`operation: funnel_*`) in the same
observability stream as operational logs. There is no queryable store and no raw
export; the deterministic operator path is to capture that stream and aggregate
it locally:

    # capture the stream (Cloudflare Workers Logs, filter operation ~ "funnel_"),
    # then per-event daily counts over the JSON-lines file:
    jq -s 'group_by(.operation + "|" + (.timestamp[0:10] // "?")) |
           map({key: .[0].operation + " " + (.[0].timestamp[0:10] // "?"),
                count: length})' funnel-events.jsonl

Daily result/error ratio for a day: count of `funnel_search_preview_result`
records with `details.result_count_bucket != "0"` over
`funnel_search_preview_error` records for the same day. Production queries stay
read-only, and no result cell below the aggregation threshold may be reported
(spec §6). Account-scoped activation measures (signup completion, first
watchlist, first proof, paid conversion) remain derived read-only D1 aggregates
(spec §3.2) and are never logged as events.

Remaining gates before any enablement: privacy/legal review, owner approval of
the final retention period, the legal-copy change to public privacy/terms pages,
and a post-enable canary (spec §8). Until those pass, the manual funnel below is
the only production funnel.

## Canary metrics (private)

- `npm run canary:prod` — JSON report via `CANARY_BYPASS_TOKEN`
- `npm run canary:billing` — webhook grant path
- `npm run canary:proof` — fresh proof + delivery

## Future (owner decision)

- Cloudflare Logpush → warehouse
- UptimeRobot SLA on `/api/health`

Do not add client-side tracking pixels without explicit owner approval.
