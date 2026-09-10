-- Generic external-source observation sink (issue #2333, R1 Architecture lens).
--
-- The snapshot/diff/alert path is shaped by Meta: `ad_observation` is
-- keyed to `ad(id)` (0001_app.sql) and `ScanPayload` is `{ads: AdRecord[]}`
-- (monitoring.server.ts). Sources that landed after Meta did NOT reuse it --
-- websites bolted a parallel `website_page_observation` table (0077) plus a
-- 1,263-line parallel module inside the ad scan, and web mentions got a third
-- table (0028). Six more sources are queued (#2181/#2188/#2189/#2193/#2194/
-- #2198/#2199/#2200); without a generic sink each one becomes another parallel
-- pile keyed to its own table.
--
-- This migration lands the GENERIC sink: one `source_observation` table with
-- NO foreign key to `ad`, so any future source writes the same shape. The
-- table is inert until the SourceAdapter seam (#2333) is wired up -- adapting
-- and persisting observations is the adapter's job, not the table's.
--
-- Migration numbering note (judge edit, #2333): 0087 was requested but is
-- already taken (0087_cta_pipeline_bail_reason_counts.sql + 0087_signup_source_
-- open_allowlist.sql), so this uses the next free number, 0090, which also
-- sorts after the current max (0089_org_scoped_ownership.sql) so the D1 sync
-- check sees it as an appended suffix.
--
-- Additive and one-way (expand/contract): a brand-new table, no existing
-- column or table is dropped or renamed, no NOT NULL is added without a
-- DEFAULT. Rolling back the PR simply never writes it; the table is inert
-- while unused.
CREATE TABLE IF NOT EXISTS source_observation (
  id TEXT PRIMARY KEY NOT NULL,
  source_kind TEXT NOT NULL,
  external_key TEXT NOT NULL,
  watchlist_run_id TEXT NOT NULL,
  snapshot_json TEXT CHECK (snapshot_json IS NULL OR length(snapshot_json) <= 20000),
  seen_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (source_kind, external_key)
);

CREATE INDEX IF NOT EXISTS idx_source_observation_source_kind
  ON source_observation(source_kind);

CREATE INDEX IF NOT EXISTS idx_source_observation_run
  ON source_observation(watchlist_run_id);