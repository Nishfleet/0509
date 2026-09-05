-- Subscription-anchored entitlement periods, auditable top-up ledger, legacy cutover mapping.

ALTER TABLE user_plan ADD COLUMN evidence_entitlement_anchor TEXT;
ALTER TABLE user_plan ADD COLUMN evidence_entitlement_anchor_source TEXT;

CREATE TABLE IF NOT EXISTS evidence_top_up_ledger_entry (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  workspace_user_id TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  reservation_id TEXT,
  idempotency_key TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_top_up_ledger_idempotency
  ON evidence_top_up_ledger_entry(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_evidence_top_up_ledger_grant
  ON evidence_top_up_ledger_entry(grant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_top_up_ledger_workspace
  ON evidence_top_up_ledger_entry(workspace_user_id, created_at);

CREATE TABLE IF NOT EXISTS proof_usage_credit_migration (
  legacy_credit_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  workspace_user_id TEXT NOT NULL,
  migrated_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  FOREIGN KEY (grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_usage_credit_migration_idempotency
  ON proof_usage_credit_migration(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_proof_usage_credit_migration_workspace
  ON proof_usage_credit_migration(workspace_user_id);
