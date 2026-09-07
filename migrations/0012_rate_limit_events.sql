CREATE TABLE IF NOT EXISTS rate_limit_events (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  route TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON rate_limit_events (scope, key_hash, route, created_at);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_cleanup
  ON rate_limit_events (created_at);
