CREATE TABLE IF NOT EXISTS better_auth_magic_link_ticket (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('login', 'signup')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_better_auth_magic_link_ticket_expires
  ON better_auth_magic_link_ticket(expires_at);

CREATE INDEX IF NOT EXISTS idx_better_auth_magic_link_ticket_consumed
  ON better_auth_magic_link_ticket(consumed_at);
