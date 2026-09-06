CREATE TABLE IF NOT EXISTS customer_api_key (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_api_key_user
  ON customer_api_key (user_id, revoked_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_api_key_hash
  ON customer_api_key (key_hash);
