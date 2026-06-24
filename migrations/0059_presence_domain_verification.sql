-- Domain ownership verification for self-tracked Presence entities.
-- Stores hashed verification tokens only — never plaintext tokens.

CREATE TABLE IF NOT EXISTS presence_domain_verification (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  tracked_entity_id TEXT NOT NULL,
  registrable_domain TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tracked_entity_id) REFERENCES tracked_entity(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presence_domain_verification_entity_domain
  ON presence_domain_verification(tracked_entity_id, registrable_domain)
  WHERE status != 'revoked';

CREATE INDEX IF NOT EXISTS idx_presence_domain_verification_user
  ON presence_domain_verification(user_id, status);
