-- Widen source_target.connector_id CHECK to accept 'threads' (issue #3254).
--
-- SQLite cannot ALTER a CHECK constraint in place, so the table is rebuilt
-- with the repo's established table-rebuild convention (0087's
-- parent-with-children pattern, first used for a connector widen in 0093):
-- create the replacement, copy rows, drop the old table, rename the
-- replacement into the original name. The children (presence_item,
-- presence_poll_cursor) hold REFERENCES source_target(id); renaming
-- source_target itself would rewrite those clauses onto a dropped temp table
-- and strand them, so the old table keeps its name until the copy is done
-- and the rebuild re-takes the name.
--
-- Data preservation: D1 runs with foreign keys ON and honors neither
-- PRAGMA foreign_keys = OFF nor PRAGMA defer_foreign_keys for DROP TABLE
-- cascades — dropping a parent table implicitly deletes its rows and the
-- ON DELETE CASCADE chains wipe presence_item, presence_poll_cursor and
-- presence_item_revision rows (verified against the real local D1 engine).
-- The three child row sets are therefore snapshotted into plain backup
-- tables first and restored after the rebuild, all inside the single
-- transaction D1 wraps the migration in.
--
-- Expand-only: every value the old CHECK accepted is still accepted, so
-- existing rows copy through unchanged, and the running old code is
-- unaffected. Rollback of the PR removes code, never data.
--
-- Merge-order note: 'gdelt' is included in this list even though its
-- connector lands in a sibling PR (#3251/#3178). If a 'gdelt' CHECK widen
-- applies before this file, its rows must still satisfy the rebuilt
-- constraint — a list without 'gdelt' would fail the INSERT..SELECT copy on
-- any existing 'gdelt' rows. Any sibling widen that lands AFTER this file
-- must carry 'threads' in its own list for the same reason.

CREATE TABLE pi_bk_0099 AS SELECT * FROM presence_item;
CREATE TABLE pc_bk_0099 AS SELECT * FROM presence_poll_cursor;
CREATE TABLE pir_bk_0099 AS SELECT * FROM presence_item_revision;

CREATE TABLE source_target_threads_widen_new (
  id TEXT PRIMARY KEY NOT NULL,
  tracked_entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL CHECK (connector_id IN ('website', 'x', 'reddit', 'linkedin', 'rss', 'gdelt', 'threads')),
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

INSERT INTO source_target_threads_widen_new (
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
ALTER TABLE source_target_threads_widen_new RENAME TO source_target;

INSERT INTO presence_item SELECT * FROM pi_bk_0099;
INSERT INTO presence_poll_cursor SELECT * FROM pc_bk_0099;
INSERT INTO presence_item_revision SELECT * FROM pir_bk_0099;
DROP TABLE pi_bk_0099;
DROP TABLE pc_bk_0099;
DROP TABLE pir_bk_0099;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_target_entity_connector_key
  ON source_target(tracked_entity_id, connector_id, target_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_source_target_user_active
  ON source_target(user_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_target_connector_active
  ON source_target(connector_id, is_active);
