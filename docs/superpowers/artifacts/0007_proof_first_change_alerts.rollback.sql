PRAGMA foreign_keys = OFF;

-- Emergency/manual rollback only.
-- Restore from a D1 backup/export first when possible. Roll-forward is preferred.
-- Keep this artifact free of explicit BEGIN/COMMIT statements for D1 compatibility.

CREATE TABLE watch_event_previous (
  id TEXT PRIMARY KEY NOT NULL,
  watchlist_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'ad_new',
      'ad_inactive',
      'landing_page_url_changed',
      'landing_page_headline_changed'
    )
  ),
  ad_id TEXT,
  baseline_from_run_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES watchlist_run(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_id) REFERENCES ad(id) ON DELETE SET NULL,
  FOREIGN KEY (baseline_from_run_id) REFERENCES watchlist_run(id) ON DELETE SET NULL
);

INSERT INTO watch_event_previous (
  id,
  watchlist_id,
  run_id,
  event_type,
  ad_id,
  baseline_from_run_id,
  title,
  summary,
  metadata_json,
  created_at
)
SELECT
  id,
  watchlist_id,
  run_id,
  event_type,
  ad_id,
  baseline_from_run_id,
  title,
  summary,
  metadata_json,
  created_at
FROM watch_event
WHERE event_type IN (
  'ad_new',
  'ad_inactive',
  'landing_page_url_changed',
  'landing_page_headline_changed'
);

DROP TABLE watch_event;
ALTER TABLE watch_event_previous RENAME TO watch_event;

CREATE INDEX IF NOT EXISTS idx_watch_event_watchlist_created
  ON watch_event(watchlist_id, created_at DESC);

DROP TABLE IF EXISTS delivery_attempt;
DROP TABLE IF EXISTS delivery_target;
DROP TABLE IF EXISTS watchlist_delivery_config;
DROP TABLE IF EXISTS workspace_delivery_config;
DROP TABLE IF EXISTS proof_capture;
DROP TABLE IF EXISTS proof_target;
DROP TABLE IF EXISTS event_candidate;

PRAGMA foreign_keys = ON;
