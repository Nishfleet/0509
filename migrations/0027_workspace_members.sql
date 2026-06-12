-- Agency team seats v1: members join the owner's workspace.
CREATE TABLE workspace_member (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  member_user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'invited',
  token_hash TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  revoked_at TEXT
);

CREATE UNIQUE INDEX idx_workspace_member_owner_email
  ON workspace_member(owner_user_id, invited_email)
  WHERE status IN ('invited', 'active');
CREATE INDEX idx_workspace_member_member
  ON workspace_member(member_user_id, status);
CREATE INDEX idx_workspace_member_token
  ON workspace_member(token_hash);
