-- Presence OAuth: one-time HMAC-signed transactions with PKCE verifier storage.

CREATE TABLE IF NOT EXISTS presence_oauth_transaction (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  workspace_user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL CHECK (connector_id IN ('website', 'x', 'reddit', 'linkedin')),
  callback_uri TEXT NOT NULL,
  return_path TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_presence_oauth_transaction_user_active
  ON presence_oauth_transaction(user_id, expires_at DESC)
  WHERE consumed_at IS NULL;
