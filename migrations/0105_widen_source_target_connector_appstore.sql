-- Issue #3210, schema-only phase. Adds appstore to the 0103 CHECK union.
-- 0104 is competitor_suggestion_dismissal. No connector code is activated.
-- Rebuild follows 0093: snapshot children, copy parent, drop/rename, restore.
-- DROP cascades even with deferred foreign keys. Do not assume this file is
-- atomic across statements. Application writes must be quiesced for execution
-- and recovery; see docs/mentions/appstore-schema-recovery.md.
-- Only the approved senior migration process may apply this to production.

CREATE TABLE pi_bk_0105 AS SELECT * FROM presence_item;
CREATE TABLE pc_bk_0105 AS SELECT * FROM presence_poll_cursor;
CREATE TABLE pir_bk_0105 AS SELECT * FROM presence_item_revision;

CREATE TABLE source_target_appstore_widen_new (
  id TEXT PRIMARY KEY NOT NULL,
  tracked_entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL CHECK (connector_id IN ('website', 'x', 'reddit', 'linkedin', 'rss', 'gdelt', 'bluesky', 'threads', 'hn', 'pinterest', 'podcast', 'youtube', 'appstore')),
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

INSERT INTO source_target_appstore_widen_new (
  id, tracked_entity_id, user_id, connector_id, target_key, target_url,
  target_handle, metadata_json, coverage_label, is_active, deleted_at,
  created_at, updated_at
)
SELECT
  id, tracked_entity_id, user_id, connector_id, target_key, target_url,
  target_handle, metadata_json, coverage_label, is_active, deleted_at,
  created_at, updated_at
FROM source_target;

DROP TABLE source_target;
ALTER TABLE source_target_appstore_widen_new RENAME TO source_target;

INSERT INTO presence_item SELECT * FROM pi_bk_0105;
INSERT INTO presence_poll_cursor SELECT * FROM pc_bk_0105;
INSERT INTO presence_item_revision SELECT * FROM pir_bk_0105;
DROP TABLE pi_bk_0105;
DROP TABLE pc_bk_0105;
DROP TABLE pir_bk_0105;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_target_entity_connector_key
  ON source_target(tracked_entity_id, connector_id, target_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_source_target_user_active
  ON source_target(user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_target_connector_active
  ON source_target(connector_id, is_active);
