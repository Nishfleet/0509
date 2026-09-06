-- Allow client-ready report snapshots to be shared via the same bearer-token share table.

ALTER TABLE share_link RENAME TO share_link_old;

CREATE TABLE share_link (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('collection', 'watchlist', 'digest', 'report')),
  resource_id TEXT NOT NULL,
  is_snapshot INTEGER NOT NULL DEFAULT 0,
  snapshot_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

INSERT INTO share_link (
  id,
  token,
  user_id,
  resource_type,
  resource_id,
  is_snapshot,
  snapshot_payload_json,
  created_at
)
SELECT
  id,
  token,
  user_id,
  resource_type,
  resource_id,
  is_snapshot,
  snapshot_payload_json,
  created_at
FROM share_link_old;

DROP TABLE share_link_old;

CREATE INDEX IF NOT EXISTS idx_share_link_token ON share_link(token);
