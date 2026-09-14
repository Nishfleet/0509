-- Widen source_target.connector_id CHECK to accept 'appstore' (issue #3210).
--
-- Same table-rebuild convention as 0093 (rss widen), the 0098 pair, 0099
-- (threads widen), 0100 (hn widen), 0101 (pinterest widen), 0102 (podcast
-- widen) and 0103 (youtube widen): SQLite cannot ALTER a CHECK in
-- place, so the table is rebuilt — create the replacement, copy rows, drop
-- the old table, rename the replacement. Children (presence_item,
-- presence_poll_cursor, presence_item_revision) hold REFERENCES
-- source_target(id) and D1's ON DELETE CASCADE would wipe them when the
-- parent is dropped, so the three child row sets are snapshotted into plain
-- backup tables first and restored after the rebuild, all inside the single
-- transaction D1 wraps the migration in.
--
-- The new CHECK carries the full thirteen-connector union: every value the
-- LIVE prior CHECK accepted plus 'appstore'. The live prior CHECK is
-- 0103_youtube's — and 0103_youtube already carries 'podcast' because
-- 0102_podcast was applied to production before its code revert and restored
-- as live history (e15f7ec77). Dropping either value here would break the
-- INSERT..SELECT copy on any live row holding it and narrow the CHECK for
-- that connector's reland — the union below is a strict superset of 0103's.
-- (Numbering history: this widen was first written as 0101_appstore and
-- collided with 0101_pinterest — two lanes each rebuilding this table from
-- the 0100 state, whichever ran second silently dropping the other's CHECK
-- value, caught by the integration test — then 0102, then 0103, and now
-- 0104 after 0103_youtube landed on main first.)
--
-- Expand-only: every value the previous CHECK accepted is still accepted, so
-- existing rows copy through unchanged, and the running old code is
-- unaffected. No drops of data tables, no renames of production columns, no
-- NOT NULL without a DEFAULT. Rollback of the PR removes code, never data.

CREATE TABLE pi_bk_0104 AS SELECT * FROM presence_item;
CREATE TABLE pc_bk_0104 AS SELECT * FROM presence_poll_cursor;
CREATE TABLE pir_bk_0104 AS SELECT * FROM presence_item_revision;

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

INSERT INTO presence_item SELECT * FROM pi_bk_0104;
INSERT INTO presence_poll_cursor SELECT * FROM pc_bk_0104;
INSERT INTO presence_item_revision SELECT * FROM pir_bk_0104;
DROP TABLE pi_bk_0104;
DROP TABLE pc_bk_0104;
DROP TABLE pir_bk_0104;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_target_entity_connector_key
  ON source_target(tracked_entity_id, connector_id, target_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_source_target_user_active
  ON source_target(user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_target_connector_active
  ON source_target(connector_id, is_active);
