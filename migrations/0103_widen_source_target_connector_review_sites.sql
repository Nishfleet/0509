-- Widen source_target.connector_id CHECK to accept 'review_sites' (issue #3209).
--
-- Same table-rebuild convention as 0093 (rss widen), the 0098 pair, 0099
-- (threads widen), 0100 (hn widen), 0101 (pinterest) and 0102 (podcast):
-- SQLite cannot ALTER a CHECK in place, so the table is rebuilt — create the
-- replacement, copy rows, drop the old table, rename the replacement.
-- Children (presence_item, presence_poll_cursor, presence_item_revision)
-- hold REFERENCES source_target(id) and D1's ON DELETE CASCADE would wipe
-- them when the parent is dropped, so the three child row sets are
-- snapshotted into plain backup tables first and restored after the rebuild,
-- all inside the single transaction D1 wraps the migration in.
--
-- The new CHECK carries the full twelve-connector union: every value the
-- 0102 podcast CHECK ('website','x','reddit','linkedin','rss','gdelt',
-- 'bluesky','threads','hn','pinterest','podcast') accepted plus
-- 'review_sites'. This file (0103) sorts AFTER 0102, so any production
-- catch-up applies the podcast widen first and this one last; this CHECK is
-- a strict superset of 0102's, so the INSERT..SELECT copy accepts every row
-- that existed under the previous CHECK — the final schema state keeps every
-- widen's connector. (The widen originally numbered 0101 was renumbered to
-- 0103 before landing: 0102 podcast reached main first, and a CHECK that
-- sorted before it would have dropped 'review_sites' from the final schema.)
--
-- Expand-only: every value the previous CHECK accepted is still accepted, so
-- existing rows copy through unchanged, and the running old code is
-- unaffected. No drops of data tables, no renames of production columns, no
-- NOT NULL without a DEFAULT. Rollback of the PR removes code, never data.

CREATE TABLE pi_bk_0103 AS SELECT * FROM presence_item;
CREATE TABLE pc_bk_0103 AS SELECT * FROM presence_poll_cursor;
CREATE TABLE pir_bk_0103 AS SELECT * FROM presence_item_revision;

CREATE TABLE source_target_review_sites_widen_new (
  id TEXT PRIMARY KEY NOT NULL,
  tracked_entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL CHECK (connector_id IN ('website', 'x', 'reddit', 'linkedin', 'rss', 'gdelt', 'bluesky', 'threads', 'hn', 'pinterest', 'podcast', 'review_sites')),
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

INSERT INTO source_target_review_sites_widen_new (
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
ALTER TABLE source_target_review_sites_widen_new RENAME TO source_target;

INSERT INTO presence_item SELECT * FROM pi_bk_0103;
INSERT INTO presence_poll_cursor SELECT * FROM pc_bk_0103;
INSERT INTO presence_item_revision SELECT * FROM pir_bk_0103;
DROP TABLE pi_bk_0103;
DROP TABLE pc_bk_0103;
DROP TABLE pir_bk_0103;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_target_entity_connector_key
  ON source_target(tracked_entity_id, connector_id, target_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_source_target_user_active
  ON source_target(user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_target_connector_active
  ON source_target(connector_id, is_active);
