# D1 growth model — headroom math against the 10 GB per-DB ceiling

Derived from schema definitions and the retention machinery in
`app/lib/retention.server.ts` and `app/lib/rate-limit.server.ts` on commit
`b9da3515c`. Byte figures are per-row *typical* sizes estimated from the
column definitions (fixed-width fields counted exactly, JSON columns by their
observed content classes); they bound steady-state storage, not a live
snapshot. No prod CF credentials are available to a repo worker, so the
runbook command to replace each estimate with a measured row count is listed
per table and belongs in the ops runbook, not CI.

D1 ceiling in force: 10 GB storage per database. SQLite page overhead adds
roughly 10–15% above raw row bytes with the indexes each table carries.
The model below therefore targets ≤ 7 GiB projected steady state, leaving
~3 GiB of headroom plus vacuum/transaction working room.

## 1. `proof_capture` — the only unbounded growth path

- Row: ~500 B fixed columns (id, status, extractor_version, timestamps,
  render_mode/device_profile) + `extracted_fields_json` (~200–1500 B),
  `capture_metadata_json` (~150 B), `field_confidence_json` +
  `extraction_warnings_json` (~100–400 B). Typical ≈ 1.2 KB/row,
  worst-case ≈ 3 KB/row. Two small indexes add ~0.15 KB/row.
- Retention: rows are NEVER deleted. The sweep
  (`deleteExpiredProofCaptureArtifacts`, artifacts older than
  `SNAPSHOT_RETENTION_DAYS` = 90 days, ≤ 20 keys/tick) clears only the R2
  `html/screenshot_artifact_key` payloads — the D1 row itself survives so
  history/billing stay reconstructable.
- Growth: one row per capture attempt (including skipped-for-budget rows,
  ~6 statuses). Model: rows/day ≈ watchlists × scans/day × proof_targets
  per scan. Steady-state bound formula:
  `bytes = captures_per_day × 365 × 0.0012 KB`.
  At a conservative 5,000 captures/day: 5,000 × 0.0012 KB = 6 KB/day of D1
  bytes → ~2.2 MB/year → ~4,500 years to the ceiling from row bytes alone.
  **D1 is not the risk for proof captures; R2 artifacts are.**
- Measured live count (runbook):
  `npx wrangler d1 execute 0509 --remote --command "SELECT COUNT(*) FROM proof_capture; -- plus AVG(LENGTH(extracted_fields_json) + LENGTH(capture_metadata_json))"`

## 2. `rate_limit_events` — self-bounding by window cleanup

- Row: exact ~200 B (uuid id ~36, scope/key_hash/route/created_at) +
  middle index entry ~100 B.
- Cleanup: every warmup pass deletes
  `created_at < now − 2 h` for normal scopes and
  `< now − 25 h` for `LONG_WINDOW_SCOPES` (`rate-limit.server.ts`).
- Steady state is therefore bounded: rows = events admitted in the longest
  window (25 h). Events are inserted only once per (scope, key, route) per
  rate-limit window (the `WHERE NOT EXISTS` / atomic-claim inserts), so an
  upper bound is
  `Σ_scopes Σ_keys limit_per_window` re-armed each window:
  e.g. `public-search`: 120/60 s per key × ~10 windows/h × 25 h ≈ 3,000
  rows/key worst case; with webhook scope 300/60 s ≈ 7,500 rows/key. Even
  500 distinct abusive keys × ~0.2 KB = ~0.1 GB — < 2% of budget, and the 2 h
  default window keeps typical populations far smaller. No action needed;
  keep the dimension guard: a new `LONG_WINDOW_SCOPE` raises the row
  dwell time from 2 h to 25 h — think in rows, not adjectives, when adding one.
- Measured live count (runbook):
  `npx wrangler d1 execute 0509 --remote --command "SELECT COUNT(*) FROM rate_limit_events;"`

## 3. `discovery_fetch_log` — 30-day retention, thin rows

- Row: ~400 B fixed + `metadata_json` ~200–600 B → ~0.8 KB/row with indexes.
- Retention: 30 days (`FETCH_LOG_RETENTION_DAYS`), 500 rows deleted per
  six-hourly warmup tick. Max swept backlog at 500/tick ≈ 2,000 rows/day;
  backlog drains only if deletions ≥ insertions — at sustained > 2,000
  fetches/day the 30-day retention becomes aspirational and the table grows
  at the excess rate (~0.8 KB × excess/day).
- Steady-state bound: `fetches_per_day × 30 × 0.0008 KB`. At 10,000
  fetches/day: 240 MB. Ingestion > 4× that rate for months would be needed
  before this table costs 1 GiB. Watch the delete-count telemetry in the
  sweep result instead of guessing.
- Measured live count (runbook):
  `npx wrangler d1 execute 0509 --remote --command "SELECT COUNT(*) FROM discovery_fetch_log;"`

## 4. `discovery_cache_entry` — expiry-bounded, fat rows

- Row: dominated by `payload_json` (provider result page) ≈ 5–40 KB/row,
  typical ≈ 12 KB.
- Retention: rows deleted once expired (`expires_at`) plus a 7-day grace
  (`EXPIRED_CACHE_GRACE_DAYS`), 200/tick → 800/day sweep ceiling; TTL for
  discovery results is roughly 1–7 days depending on route context
  (`watchlist_scan`, `public_search`, `scheduled_warmup`).
- Steady state ≈ `entries_per_day × (TTL + 7d) × 12 KB`. At 2,000 entries/day
  and a 4-day TTL: 2,000 × 11 days × 0.012 MB ≈ 264 MB. Cap on the sweep
  ceiling is the risk: sustained ≥ 800 expires/day backs the queue up and
  growth becomes `excess × 12 KB/day`. Monitor `deleted.discovery_cache_entry`
  per tick; alarm when it pins at 200.
- Measured live count (runbook):
  `npx wrangler d1 execute 0509 --remote --command "SELECT COUNT(*), AVG(LENGTH(payload_json)) FROM discovery_cache_entry;"`

## 5. Funnel events — zero D1 bytes by design

Funnel records (`funnel_home_view` etc., `app/lib/funnel-measurement.server.ts`)
are emitted to Workers observability logs (`logAppEvent` → `console.*`),
never inserted into D1. Their growth model is a log-pipeline/billing question
(Workers Logs retention), not a D1 one. The spec
(`docs/funnel-measurement-spec.md`) deliberately forbids any D1 persistence of
funnel records; this model records that constraint so nobody "helpfully"
adds a funnel table.

## Summary table

| Table | Typical row | Retention | Steady state (formula) | Headroom note |
| --- | --- | --- | --- | --- |
| proof_capture | 1.2 KB | none (rows) | captures/day × 365 × 1.2 KB/yr | centuries (row bytes only) |
| rate_limit_events | 0.2 KB | 2 h / 25 h by scope | Σ keys × limit/window × windows | days, decays; bounded |
| discovery_fetch_log | 0.8 KB | 30 d | fetches/day × 30 × 0.0008 MB | ≥ 180 d @ 10 k/day |
| discovery_cache_entry | 12 KB | TTL + 7 d grace | entries/day × (TTL+7) × 12 KB | months; sweep ceiling 800/day |

Soaks to worry about: only where steady state is unbounded — proof_capture
rows (2.2 MB/day at 5,000/day) and the two sweep-throughput ceilings
(2,000 discovery_fetch_log and 800 discovery_cache_entry rows per day). None
of these threatens 10 GB this quarter; each name needs an alarm or a follow-up
retention policy before it can.
