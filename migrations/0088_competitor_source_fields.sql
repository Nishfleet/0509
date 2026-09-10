-- Issue #2218 (seam): competitor-monitoring source fields and generic snapshot
-- storage.
--
-- Scope: two additive changes, both nullable / IF NOT EXISTS, so the running
-- old code is unaffected:
--
--   1. Four nullable columns on `watchlist` for the source tickets that need
--      competitor-specific identifiers:
--        tiktok_advertiser   TEXT     — TikTok advertiser id (#2194)
--        job_board_provider   TEXT     — job board provider slug (#2199)
--        job_board_slug       TEXT     — job board company slug (#2199)
--        job_board_verified   INTEGER  — 0/1 verification flag (#2199)
--
--   2. A generic `source_snapshot` table. The existing Meta snapshot path
--      (`landing_page_snapshot`) is landing-page-specific: its columns
--      (normalized_headline_hash, cta_text, price_text, form_present) cannot
--      hold arbitrary source payloads (Google SERP results, TikTok ad
--      metadata, crt.sh subdomain lists, job postings). A generic table is
--      required rather than overloading the landing-page table. The seam
--      owns this table; each source ticket writes rows through the generic
--      `persistSourceSnapshot` helper.
--
-- D1 expand/contract phase 1 — additive only, no DROP / NOT NULL / rename.
-- Every existing row stays untouched (new columns default to NULL). The
-- migration applies at the standard cadence (`wrangler d1 migrations apply`).

ALTER TABLE watchlist ADD COLUMN tiktok_advertiser TEXT;
ALTER TABLE watchlist ADD COLUMN job_board_provider TEXT;
ALTER TABLE watchlist ADD COLUMN job_board_slug TEXT;
ALTER TABLE watchlist ADD COLUMN job_board_verified INTEGER;

CREATE TABLE IF NOT EXISTS source_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  source_id TEXT NOT NULL CHECK (
    source_id IN (
      'google',
      'google_ads',
      'linkedin',
      'tiktok',
      'subdomains',
      'hiring'
    )
  ),
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_snapshot_watchlist_source_fetched
  ON source_snapshot(watchlist_id, source_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_snapshot_watchlist_created
  ON source_snapshot(watchlist_id, created_at DESC);
