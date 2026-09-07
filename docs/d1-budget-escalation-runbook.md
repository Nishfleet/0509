# D1 budget escalation runbook (issue #1731)

Cloudflare enforces D1 free-tier daily limits on this account: **5,000,000 rows
read** and **100,000 rows written** per day (enforcement began 2026-09-01;
0509 runs on Workers Free — see `wrangler.jsonc`, no `usage_model: "paid"`).
When a daily limit is crossed, Cloudflare emails the account owner and D1
starts returning errors until the UTC day rolls over.

## Trip-wires that fire before the email

- `scripts/ci-d1-budget-check.sh` runs in `ci.yml` (required job
  `d1-budget-check`, plus a step ahead of the D1 vitest suites) and in the
  `deploy` job of `deploy-production.yml`. It estimates daily rows via
  `EXPLAIN QUERY PLAN` over the migrated schema plus declared canary budgets,
  and fails past 10% of the daily limit (`scripts/d1-budget-estimates.json`,
  `tripFraction`).
- Every `scripts/*canary*.mjs` entrypoint and `.github/workflows/*canary*.yml`
  declares `d1-budget: reads=<n> writes=<n> runs_per_day=<n>`; the check sums
  them into the daily estimate.

## When the Cloudflare alert email lands

1. **Confirm which database and which queries blew the limit.**
   Cloudflare dashboard → Workers & Pages → D1 → `0509` → Metrics, or the
   GraphQL Analytics API (`d1QueriesAdaptiveGroups` / `d1AnalyticsAdaptiveGroups`
   on the account, filtered to `databaseId`/`date`) shows rows read/written.
   Match the spike window against cron ticks in `workers/schedule.ts`
   (`REGULAR_MONITORING_CRON` every 3h, `DISCOVERY_WARMUP_CRON` every 6h,
   `DAILY_DIGEST_CRON` 04:00, `WEEKLY_DIGEST_CRON` Mon 05:00) and recent
   canary runs.
2. **Throttle the offender.** The monitoring fan-out is the largest scheduled
   reader. Set `MONITORING_FANOUT_MODE=inline` (or reduce
   `MONITORING_FANOUT_MAX_INFLIGHT`) in `wrangler.jsonc` to shrink per-tick D1
   work, or widen the cron interval in `workers/schedule.ts`. Ship through the
   normal PR path — the budget check must stay green.
3. **Decide wait-vs-upgrade.** The limit resets at UTC midnight; reads and
   writes are metered separately. If the breach is a one-off spike, wait for
   reset. If `scripts/ci-d1-budget-check.sh` is approaching the trip threshold
   on normal traffic, that is the signal to talk to Nish about a paid plan —
   upgrading is a money decision and is his alone.
4. **Log the incident.** Append what blew the limit, the measured rows, the
   throttle applied, and the outcome to `docs/PROJECT-HISTORY.md`, and update
   `scripts/d1-budget-estimates.json` with the measured row counts
   (`wrangler d1 execute 0509 --remote --command "SELECT COUNT(*) FROM <table>"`,
   bump `capturedAt`).

## When the CI check fails instead

A red `d1-budget-check` means a change grew the estimated daily footprint past
10% of the free-tier limit. Fix by adding an index (SCAN → SEARCH), reducing
`callsPerDay` where the estimate was wrong, or lowering the declared canary
budget — never by raising `tripFraction` to silence it. If the footprint is
genuinely that large, the product has outgrown the free tier; that goes to
Nish.
