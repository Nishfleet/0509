-- Monthly included evidence-check usage periods (subscription-anchored months).
CREATE TABLE IF NOT EXISTS evidence_usage_period (
  id TEXT PRIMARY KEY,
  workspace_user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  plan_family TEXT NOT NULL,
  included_allowance INTEGER NOT NULL,
  included_consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_usage_period_workspace_start
  ON evidence_usage_period(workspace_user_id, period_start);

CREATE INDEX IF NOT EXISTS idx_evidence_usage_period_workspace_end
  ON evidence_usage_period(workspace_user_id, period_end);
