-- Presence Tracking v1: unified entity model, sources, normalized items.

CREATE TABLE IF NOT EXISTS tracked_entity (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('self', 'competitor')),
  label TEXT NOT NULL,
  canonical_url TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracked_entity_user_active_updated
  ON tracked_entity(user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracked_entity_user_mode_active
  ON tracked_entity(user_id, tracking_mode, is_active);

CREATE TABLE IF NOT EXISTS source_target (
  id TEXT PRIMARY KEY NOT NULL,
  tracked_entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL CHECK (connector_id IN ('website', 'x', 'reddit', 'linkedin')),
  target_key TEXT NOT NULL,
  target_url TEXT,
  target_handle TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  coverage_label TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tracked_entity_id) REFERENCES tracked_entity(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_target_entity_connector_key
  ON source_target(tracked_entity_id, connector_id, target_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_source_target_user_active
  ON source_target(user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_target_connector_active
  ON source_target(connector_id, is_active);

CREATE TABLE IF NOT EXISTS source_connection (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  tracked_entity_id TEXT,
  connector_id TEXT NOT NULL CHECK (connector_id IN ('website', 'x', 'reddit', 'linkedin')),
  encrypted_credentials TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'healthy', 'degraded', 'revoked')),
  scopes_json TEXT NOT NULL DEFAULT '[]',
  external_account_id TEXT,
  external_account_label TEXT,
  last_health_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (tracked_entity_id) REFERENCES tracked_entity(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connection_user_connector_account
  ON source_connection(user_id, connector_id, external_account_id)
  WHERE revoked_at IS NULL AND external_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_source_connection_entity
  ON source_connection(tracked_entity_id, connector_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS presence_item (
  id TEXT PRIMARY KEY NOT NULL,
  source_target_id TEXT NOT NULL,
  tracked_entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  external_id TEXT,
  canonical_url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  body_excerpt TEXT,
  author TEXT,
  published_at TEXT,
  observed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_json TEXT,
  is_tombstone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_target_id) REFERENCES source_target(id) ON DELETE CASCADE,
  FOREIGN KEY (tracked_entity_id) REFERENCES tracked_entity(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presence_item_target_url_hash
  ON presence_item(source_target_id, url_hash)
  WHERE is_tombstone = 0;

CREATE INDEX IF NOT EXISTS idx_presence_item_entity_observed
  ON presence_item(tracked_entity_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_presence_item_user_connector_observed
  ON presence_item(user_id, connector_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS presence_poll_cursor (
  source_target_id TEXT PRIMARY KEY NOT NULL,
  cursor_json TEXT NOT NULL DEFAULT '{}',
  etag TEXT,
  last_modified TEXT,
  last_polled_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_target_id) REFERENCES source_target(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS presence_entity_link (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('same_brand', 'subsidiary', 'verified_alias')),
  evidence_url TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (from_entity_id) REFERENCES tracked_entity(id) ON DELETE CASCADE,
  FOREIGN KEY (to_entity_id) REFERENCES tracked_entity(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presence_entity_link_pair
  ON presence_entity_link(from_entity_id, to_entity_id, link_type);

CREATE TABLE IF NOT EXISTS presence_alert_cursor (
  user_id TEXT NOT NULL,
  tracked_entity_id TEXT NOT NULL,
  last_notified_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tracked_entity_id),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (tracked_entity_id) REFERENCES tracked_entity(id) ON DELETE CASCADE
);
