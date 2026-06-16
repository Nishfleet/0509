CREATE TABLE IF NOT EXISTS stytch_identity (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  stytch_organization_id TEXT NOT NULL,
  stytch_member_id TEXT NOT NULL,
  organization_name TEXT,
  organization_slug TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stytch_identity_member
  ON stytch_identity(stytch_organization_id, stytch_member_id);

CREATE INDEX IF NOT EXISTS idx_stytch_identity_user
  ON stytch_identity(user_id);

CREATE TABLE IF NOT EXISTS stytch_auth_request (
  state TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('login', 'signup')),
  name TEXT,
  organization_name TEXT,
  redirect_to TEXT NOT NULL,
  intermediate_session_token TEXT,
  confirmation_secret TEXT,
  confirmation_nonce TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stytch_auth_request_expires
  ON stytch_auth_request(expires_at);
