CREATE TABLE IF NOT EXISTS agent_action_audit (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  api_key_id TEXT,
  action_name TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  idempotency_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (api_key_id) REFERENCES customer_api_key(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_action_audit_user_idempotency
  ON agent_action_audit(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_action_audit_user_created
  ON agent_action_audit(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_action_audit_resource
  ON agent_action_audit(resource_type, resource_id, created_at DESC)
  WHERE resource_type IS NOT NULL AND resource_id IS NOT NULL;
