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

Specification: see [docs/funnel-measurement-spec.md](./funnel-measurement-spec.md).
**Collection is NOT live.** A default-off implementation exists so the increment can be
reviewed and tested without producing a single record:

> **[NISH] CONTRADICTION RESOLVED (2026-09-04, issue #1278):** the production config
> once set `FUNNEL_MEASUREMENT_ENABLED: "1"` while this section said collection was
> not live and the spec §8 gates were still required — docs and config disagreed.
> The worker took the flip-to-off path (worker default; re-enablement is
> `[NISH]`-reserved): `wrangler.jsonc` now sets `FUNNEL_MEASUREMENT_ENABLED: "0"`,
> so the gate is off in production and docs and config agree. The decision
> request and the two resolution paths are recorded in
> `docs/funnel-measurement-decision-2026-08.md`; re-enablement once the §8 gates
> clear is tracked in issue #1590.

- **Gate.** Anonymous funnel events (`funnel_home_view`, `funnel_search_preview_*`,
  `funnel_signup_start`) are emitted by `app/lib/funnel-measurement.server.ts` only when
  the environment variable `FUNNEL_MEASUREMENT_ENABLED` is exactly
  `1`/`true`/`yes`/`on` (case-insensitive). Absent, empty, or any other value leaves
  measurement disabled — an absent variable can never turn it on. Production sets the
  variable to `"0"`, so collection stays off until the §8 gates below are cleared.
- **GPC.** Requests carrying the Global Privacy Control signal (`Sec-GPC: 1`, per the
  W3C GPC spec) record nothing, even when the gate is on.
- **Boundaries.** Homepage view: `app/routes/marketing.tsx` loader. Search preview
  submit/result/error: `app/routes/search.tsx` loader (submit counts a fresh query
  without a selection or pagination cursor; failures are rethrown unchanged after a
  coarse `error_kind` record; result counts are bounded to the spec buckets
  `0`/`1-10`/`11-50`/`51+`). Signup start: `app/routes/auth.signup.tsx` and
  `app/routes/auth.better.oauth.ts` signup actions.
- **Fields.** Records carry only the spec §4 allowlist: `event_id` (server-generated),
  record-level server `timestamp`, `route`, `account_scope: "anonymous"`, plus
  `result_count_bucket` or `error_kind` where applicable. No query text, URLs, emails,
  names, error text, or stack traces can enter a record — the helper only accepts typed
  coarse inputs.
- **Operator aggregates.** `node scripts/funnel-daily-counts.mjs` reads NDJSON log
  lines from stdin (e.g. `wrangler tail --format json`) and prints bounded daily counts
  per event with bucket/error-kind distributions. It never prints raw records and flags
  any record carrying keys outside the allowlist.
- **Account-scoped measures.** Signup completion, first watchlist, first proof, and
  paid conversion remain read-only aggregate queries over existing D1 records (`user`,
  `watchlist`, `proof_capture`, `user_plan`); they are never emitted as anonymous
  events or logged.
- **Still required before enablement** (spec §8 gates): privacy/legal review, owner
  approval including the final retention period, policy-surface copy on the public
  privacy/terms pages, and a post-enable canary. **Enablement deferred; flag currently off in production.** Re-enablement is tracked in issue #1590 and
  `docs/funnel-measurement-decision-2026-08.md`. Do not claim live numbers until
  those pass.

The funnel remains manual (inferred from auth tables) with no automated collection in
production.

## Canary metrics (private)

- `npm run canary:prod` — JSON report via `CANARY_BYPASS_TOKEN`
- `npm run canary:billing` — webhook grant path
- `npm run canary:proof` — fresh proof + delivery

## Future (owner decision)

- Cloudflare Logpush → warehouse
- UptimeRobot SLA on `/api/health`

Do not add client-side tracking pixels without explicit owner approval.
