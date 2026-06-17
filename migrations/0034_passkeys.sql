CREATE TABLE IF NOT EXISTS passkey_credential (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  stytch_organization_id TEXT NOT NULL,
  stytch_member_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  webauthn_user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports_json TEXT,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_passkey_credential_id
  ON passkey_credential(credential_id);

CREATE INDEX IF NOT EXISTS idx_passkey_credential_user
  ON passkey_credential(user_id);

CREATE INDEX IF NOT EXISTS idx_passkey_credential_member
  ON passkey_credential(stytch_organization_id, stytch_member_id);

CREATE TABLE IF NOT EXISTS passkey_challenge (
  state TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
  user_id TEXT,
  challenge TEXT NOT NULL,
  redirect_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkey_challenge_expires
  ON passkey_challenge(expires_at);

CREATE INDEX IF NOT EXISTS idx_passkey_challenge_user
  ON passkey_challenge(user_id);
