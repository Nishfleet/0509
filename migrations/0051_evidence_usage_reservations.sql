-- Concurrency-safe evidence usage reservations and settlement.
CREATE TABLE IF NOT EXISTS evidence_usage_reservation (
  id TEXT PRIMARY KEY,
  workspace_user_id TEXT NOT NULL,
  usage_period_id TEXT,
  top_up_grant_id TEXT,
  logical_operation_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  settled_at TEXT,
  released_at TEXT,
  source TEXT NOT NULL,
  FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (usage_period_id) REFERENCES evidence_usage_period(id) ON DELETE SET NULL,
  FOREIGN KEY (top_up_grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_usage_reservation_logical_key
  ON evidence_usage_reservation(logical_operation_key);

CREATE INDEX IF NOT EXISTS idx_evidence_usage_reservation_workspace_status
  ON evidence_usage_reservation(workspace_user_id, status, expires_at);
