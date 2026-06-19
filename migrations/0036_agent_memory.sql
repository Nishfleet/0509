CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'customer', 'brand', 'competitor')),
  memory_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  UNIQUE (user_id, scope, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_user_scope_updated
  ON agent_memory(user_id, scope, updated_at DESC);
