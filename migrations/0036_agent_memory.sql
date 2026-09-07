CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('workspace', 'customer', 'brand', 'competitor')),
  memory_key TEXT NOT NULL,
  watchlist_id TEXT,
  client_room_id TEXT,
  value_json TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (watchlist_id) REFERENCES watchlist(id) ON DELETE CASCADE,
  FOREIGN KEY (client_room_id) REFERENCES client_room(id) ON DELETE CASCADE,
  CHECK (watchlist_id IS NULL OR client_room_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_user_scope_updated
  ON agent_memory(user_id, scope, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_user_key_global
  ON agent_memory(user_id, scope, memory_key)
  WHERE watchlist_id IS NULL AND client_room_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_user_key_watchlist
  ON agent_memory(user_id, scope, memory_key, watchlist_id)
  WHERE watchlist_id IS NOT NULL AND client_room_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_user_key_client_room
  ON agent_memory(user_id, scope, memory_key, client_room_id)
  WHERE watchlist_id IS NULL AND client_room_id IS NOT NULL;
