-- Widen source_target.connector_id CHECK to accept BOTH 'gdelt' AND
-- 'bluesky' regardless of 0098 application order (epic #3171, #3179).
--
-- Why a third rebuild: the two 0098 widens each rebuilt source_target with
-- their OWN 6-value CHECK — gdelt's variant lacks 'bluesky', bluesky's
-- variant lacks 'gdelt'. Whichever 0098 applies LAST wins the final CHECK,
-- so the order-divergent ledgers disagree AND each loses one connector:
-- production applied gdelt-then-bluesky (declared order exception,
-- 8bef18ec2), so its final CHECK has no 'gdelt'; a fresh lexicographic
-- apply (bluesky-then-gdelt, which is also what the integration fixtures
-- do) ends with no 'bluesky'. Both connectors' rollout gates were closed at
-- the time, so no INSERT had tripped it yet. tests/integration/
-- mention-digest-resweep.integration.test.ts (epic #3171) seeds gdelt AND
-- bluesky mention items against the repo's real migrations and caught the
-- fresh-apply side: "CHECK constraint failed: connector_id IN ('website',
-- 'x', 'reddit', 'linkedin', 'rss', 'gdelt')".
--
-- Same table-rebuild convention as 0093/0098: SQLite cannot ALTER a CHECK
-- in place, so the table is rebuilt — create the replacement, copy rows,
-- drop the old table, rename the replacement. Children (presence_item,
-- presence_poll_cursor, presence_item_revision) hold REFERENCES
-- source_target(id) and D1's ON DELETE CASCADE would wipe them when the
-- parent is dropped, so the three child row sets are snapshotted into plain
-- backup tables first and restored after the rebuild, all inside the single
-- transaction D1 wraps the migration in.
--
-- Expand-only: every value either 0098 CHECK accepted is still accepted by
-- this 7-value CHECK, so existing rows copy through unchanged and the
-- running old code is unaffected. Any row that exists satisfies the interim
-- 0098 CHECK that its ledger produced, hence also this superset. No drops of
-- data tables, no renames of production columns, no NOT NULL without a
-- DEFAULT. Rollback of the PR removes code, never data.

CREATE TABLE pi_bk_0099 AS SELECT * FROM presence_item;
CREATE TABLE pc_bk_0099 AS SELECT * FROM presence_poll_cursor;
CREATE TABLE pir_bk_0099 AS SELECT * FROM presence_item_revision;

CREATE TABLE source_target_gdelt_bluesky_widen_new (
  id TEXT PRIMARY KEY NOT NULL,
  tracked_entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL CHECK (connector_id IN ('website', 'x', 'reddit', 'linkedin', 'rss', 'gdelt', 'bluesky')),
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

INSERT INTO source_target_gdelt_bluesky_widen_new (
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
ALTER TABLE source_target_gdelt_bluesky_widen_new RENAME TO source_target;

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
