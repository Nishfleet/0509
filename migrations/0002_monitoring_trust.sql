PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS meta_integration_log_new;

CREATE TABLE meta_integration_log_new (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy', 'demo', 'degraded')),
  summary TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO meta_integration_log_new (
  id,
  status,
  summary,
  error_code,
  error_message,
  metadata_json,
  created_at
)
SELECT
  id,
  status,
  summary,
  error_code,
  error_message,
  metadata_json,
  created_at
FROM meta_integration_log;

DROP TABLE meta_integration_log;
ALTER TABLE meta_integration_log_new RENAME TO meta_integration_log;
CREATE INDEX IF NOT EXISTS idx_meta_integration_created ON meta_integration_log(created_at DESC);

WITH ranked_watchlists AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, target_fingerprint
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_rank
  FROM watchlist
  WHERE is_active = 1
)
UPDATE watchlist
SET is_active = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT id
  FROM ranked_watchlists
  WHERE row_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_user_fingerprint_active
  ON watchlist(user_id, target_fingerprint)
  WHERE is_active = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_run_user_period_unique
  ON digest_run(user_id, period_start, period_end);

PRAGMA foreign_keys = ON;
