CREATE TABLE IF NOT EXISTS stytch_session (
  session_token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  member_session_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_stytch_session_user
  ON stytch_session(user_id);

CREATE INDEX IF NOT EXISTS idx_stytch_session_expires
  ON stytch_session(expires_at);
