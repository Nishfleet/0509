CREATE TABLE IF NOT EXISTS client_room (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  client_label TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  notes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_client_room_user_status_updated
  ON client_room(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS client_room_resource (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('collection', 'watchlist', 'digest', 'report')),
  resource_id TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES client_room(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  UNIQUE (room_id, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_client_room_resource_user_resource
  ON client_room_resource(user_id, resource_type, resource_id);
