# Lane report — claim/issue-3521

Issue `Nishfleet/0509#3521`: the already-emitted spec-§4 funnel events
(`home_view`, `search_preview_submit`, `search_preview_result`,
`search_preview_error`, `signup_start`, plus the later emitted kinds) were
console-only — trailing-7d counts were not readable by one operator command,
so visit→signup conversion could not be computed.

## Change

- `wrangler.jsonc`: `analytics_engine_datasets` binding `FUNNEL_ANALYTICS` →
  dataset `funnel_events` on the existing Worker. No new Worker, cron, D1
  table, or migration.
- `app/lib/env.server.ts`: `FUNNEL_ANALYTICS?: AnalyticsEngineDataset` on
  `AppEnv` (optional — tests/dev envs build env objects by hand).
- `app/lib/funnel-measurement.server.ts`: `writeFunnelDataPoint` writes the
  already-§4-allowlisted record via `writeDataPoint` inside `emitFunnelEvent`
  — `funnel_<kind>` in blob1, route/account_scope/result_count_bucket/
  error_kind in blob2–blob5, `[1]` double, `event_id` as the sampling index.
  Never throws; absent binding degrades to log-only; a platform write failure
  logs `analytics_funnel_write_failed` (deliberately outside the reserved
  `funnel_` op namespace so aggregate readers can never count it). Console
  log path unchanged.
- `scripts/weekly-business-metrics.mjs`: `.funnel` JSON section + markdown
  section 9. One Analytics Engine SQL-API round trip (`sumIf` +
  `SUM(_sample_interval)`, sample-corrected) yields per-kind 7d/30d counts;
  headline kinds exposed as `home_view_7d` etc. Credential order:
  `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` env, then
  `~/.config/cloudflare/deploy.env`, then `analytics.env`. Missing
  credentials or a failed query → `available: false` + reason, never a
  manufactured zero. A not-yet-created dataset returns empty rows → honest
  zeros.
- `docs/ga-metrics.md`, `docs/funnel-measurement-spec.md` (§7.1, §8, §8.7):
  sink, field mapping, read path, credential order, retention (Workers Logs
  7d + AE ~3 months, inside the approved 90-day bound).
- Tests: `tests/funnel-measurement.test.ts` (+105) — committed-binding guard,
  exact datapoint field mapping against the emitted record, gate-off/GPC
  no-write, absent/throwing binding resilience. `tests/unit/
  weekly-business-metrics.test.ts` (+45) — query shape, row→JSON mapping,
  non-`funnel_` row exclusion, empty-dataset zero-fill.

## Constraints held

No allowlist widening, no query text/IP/new fields, no migrations/**, no new
organ — the existing deploy token already carries Account Analytics Read
(verified live: `SHOW TABLES`, `sumIf` aggregation round trip).

## Evidence

- `npx vitest run --configLoader runner --project node
  tests/funnel-measurement.test.ts tests/unit/weekly-business-metrics.test.ts
  tests/weekly-business-metrics.test.ts tests/funnel-daily-counts.test.ts`
  → 69 passed (4 files).
- `node scripts/weekly-business-metrics.mjs --json` (deploy.env sourced)
  → `funnel.available: true`, `credential_source: "CLOUDFLARE_* environment"`,
  all headline kinds `events_7d/30d: 0` (dataset creates on first write
  post-deploy).
- Issue verify line:
  `node scripts/weekly-business-metrics.mjs --json | jq -e
  '.funnel.search_preview_submit_7d >= 0 and .funnel.home_view_7d >= 0'`
  → `true`.
- `curl -sS -o /dev/null -w '%{http_code}'
  'https://0509.io/search?q=nike&country=all'` → `200`.
- `npx tsc --checkJs --strict --noEmit --skipLibCheck --module nodenext
  scripts/weekly-business-metrics.mjs` → clean (local scoped check only;
  `npm run typecheck` is CI-owned per AGENTS.md).
- `git diff --check` → clean.
