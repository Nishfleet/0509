CREATE TABLE IF NOT EXISTS proof_usage_credit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL UNIQUE,
  provider_product_id TEXT NOT NULL,
  bundle_slug TEXT NOT NULL,
  credits INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proof_usage_credit_user_window
  ON proof_usage_credit(user_id, granted_at, expires_at);
