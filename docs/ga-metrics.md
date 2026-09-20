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

### The direction metric: signups/week

The **direction metric** (fleet-ops#4518) is signups/week — the fixture-free
trailing-7d/30d count of production `user.createdAt` rows, emitted by:

```bash
gh workflow run market-signal-snapshot.yml --ref main   # was: node scripts/weekly-business-metrics.mjs --json
```

That JSON (its `signups_7d`) — not the unfiltered day-count above — is the
number the direction entry records. The script excludes the shared
fleet-synthetic identity list `SYNTHETIC_USER_PATTERNS`: the #2908 QA/canary
fixture identities (billing-canary, `codex-qa-*`, `codex-free-qa-*`,
`auth-QA`), the billing-canary guard id, the launch-readiness canary owner
id, every `*@0509.internal` mailbox, and the `bet1-3322-*` burst cohort — the
same list `db/queries/market-signal.sql` consumes, so the two reads
cannot drift (issues #3471, #3486). When the caller supplies the
Workers-Logs NDJSON (`--events-ndjson <path|->`) it cross-checks each
surviving row against its `signup_completed` funnel event; survivors without
one are listed as `suspect`, never silently counted. Its definition, fixture
list, and its test live in `db/queries/market-signal.sql` and
`tests/market-signal-query.test.ts` (issue #3321). The previous home,
`scripts/weekly-business-metrics.mjs` with `tests/unit/weekly-business-metrics.test.ts`,
was 1,328 lines that CI never ran; it was deleted 2026-09-20 and the query it
wrapped now runs as one `wrangler d1 execute --remote --command` step in
`.github/workflows/market-signal-snapshot.yml` (`--file` returns an execution
summary, not rows — issue #3848).

## Launch funnel (manual)

1. Homepage → signup (no automated funnel — infer from auth tables).
2. Signup → first watchlist (`workspace readiness` items).
3. First watchlist → first successful proof (`proof_capture` stats).
4. Free → paid (`user_plan` transitions).

## Funnel measurement status

Specification: see [docs/funnel-measurement-spec.md](./funnel-measurement-spec.md).
**Collection is live since 2026-09-09.** The spec §8 rollout gates cleared that day —
privacy-page copy (#2105), redaction test (#2103), retention/delete test (#2104), and
Nish's gates 1-2 approval recorded on issue #2106 — and `wrangler.jsonc` sets
`FUNNEL_MEASUREMENT_ENABLED: "1"`.

**Approved retention period: 90 days** (Nish, 2026-09-09, issue #2106). Funnel events
live in two bounded stores: structured JSON lines in Workers Logs (platform window
7 days on this Workers Paid account, spec §8.7) and the Workers Analytics Engine
`funnel_events` dataset (platform retention ~3 months — materially the approved
90-day bound; no funnel event is kept longer).

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
  variable to `"1"` (gates cleared 2026-09-09, issue #2106), so collection is on.
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
- **Operator aggregates.** (`scripts/funnel-daily-counts.mjs`, deleted 2026-09-20, read NDJSON log
  lines from stdin (e.g. `wrangler tail --format json`) and prints bounded daily counts
  per event with bucket/error-kind distributions. It never prints raw records and flags
  any record carrying keys outside the allowlist.
- **Queryable sink (issue #3521).** Every emitted record also lands in the Workers
  Analytics Engine dataset `funnel_events` (binding `FUNNEL_ANALYTICS` in
  `wrangler.jsonc`), written inside `emitFunnelEvent` from the already-filtered §4
  record: `funnel_<kind>` in `blob1`, `route`/`account_scope`/`result_count_bucket`/
  `error_kind` in `blob2`–`blob5`, the `event_id` as the sampling index. No field
  outside the §4 allowlist can reach the dataset, and a missing binding degrades to
  log-only emission — never a request failure.
- **Read path.** The market-signal workflow's snapshot JSON carries the funnel
  section as `.funnel`: `<kind>_7d`/`<kind>_30d` counts for the visit→signup kinds
  (`home_view`, `search_preview_submit`, `search_preview_result`,
  `search_preview_error`, `signup_start`) plus a `kinds` table covering every emitted
  kind — the visit→signup conversion read the direction metric was blind to. The
  markdown report prints the same table as section 9. Both modes query the account
  Analytics Engine SQL API with `sumIf`/`SUM(_sample_interval)` (sample-corrected);
  credentials resolve from `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, then
  `~/.config/cloudflare/deploy.env`, then `analytics.env`. `funnel.available: false`
  means the read could not run — counts are absent, never zeroed.
- **Account-scoped measures.** Signup completion, first watchlist, first proof, and
  paid conversion remain read-only aggregate queries over existing D1 records (`user`,
  `watchlist`, `proof_capture`, `user_plan`); they are never emitted as anonymous
  events or logged.
- **Post-enable canary** (spec §8 gate 8): after each deploy that ships the enabled
  flag, check that `/` behaves identically for an opted-out visitor (spec §5):

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' https://0509.io/
  curl -s -o /dev/null -w '%{http_code}\n' -H 'Sec-GPC: 1' https://0509.io/
  ```

  Both must be 200. Rollback plan on a red canary: flip
  `FUNNEL_MEASUREMENT_ENABLED` back to `"0"` in `wrangler.jsonc` and redeploy.

  (`scripts/funnel-canary-check.mjs` was 141 lines wrapping exactly those two
  requests, run by no workflow and no npm script. Deleted 2026-09-20 — two curls
  are the whole check.)

Anonymous funnel events collect through the structured-logs path above; the
account-scoped measures (signup completion, first watchlist, first proof, paid
conversion) remain read-only aggregate queries over existing D1 records — never
emitted as events.

## Canary metrics (private)

- `npm run canary:prod` — JSON report via `CANARY_BYPASS_TOKEN`
- `npm run canary:billing` — webhook grant path
- `npm run canary:proof` — fresh proof + delivery

## Future (owner decision)

- Cloudflare Logpush → warehouse
- UptimeRobot SLA on `/api/health`

Do not add client-side tracking pixels without explicit owner approval.
