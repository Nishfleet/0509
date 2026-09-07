-- Non-expiring workspace top-up grants and audited adjustments.
CREATE TABLE IF NOT EXISTS evidence_top_up_grant (
  id TEXT PRIMARY KEY,
  workspace_user_id TEXT NOT NULL,
  sku_slug TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  provider_product_id TEXT NOT NULL,
  quantity_granted INTEGER NOT NULL,
  -- Cache only: authoritative balance = quantity_granted + SUM(ledger.quantity_delta).
  quantity_remaining INTEGER NOT NULL,
  granted_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  catalog_version TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_top_up_grant_payment
  ON evidence_top_up_grant(provider_payment_id);

CREATE INDEX IF NOT EXISTS idx_evidence_top_up_grant_workspace_active
  ON evidence_top_up_grant(workspace_user_id, status, granted_at);

CREATE TABLE IF NOT EXISTS evidence_top_up_adjustment (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  workspace_user_id TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  provider_event_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (grant_id) REFERENCES evidence_top_up_grant(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_top_up_adjustment_idempotency
  ON evidence_top_up_adjustment(idempotency_key);
