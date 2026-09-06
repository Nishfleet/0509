CREATE TABLE IF NOT EXISTS customer_meta_connection (
  user_id TEXT PRIMARY KEY NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  token_last_four TEXT NOT NULL,
  token_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('untested', 'healthy', 'degraded')),
  summary TEXT NOT NULL,
  last_checked_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_meta_connection_fingerprint
  ON customer_meta_connection(token_fingerprint);
