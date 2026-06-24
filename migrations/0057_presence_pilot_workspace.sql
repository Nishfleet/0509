-- Controlled pilot allowlist for Presence website tracking.
-- Stores SHA-256 hashes of workspace user ids — never raw customer ids.

CREATE TABLE IF NOT EXISTS presence_pilot_workspace (
  workspace_id_hash TEXT PRIMARY KEY NOT NULL,
  invited_at TEXT NOT NULL,
  invited_by TEXT,
  notes TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_presence_pilot_workspace_active
  ON presence_pilot_workspace(invited_at DESC)
  WHERE revoked_at IS NULL;
