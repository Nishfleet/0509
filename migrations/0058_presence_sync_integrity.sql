-- Presence sync integrity: content revisions, reconciliation indexes.

ALTER TABLE presence_item ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS presence_item_revision (
  id TEXT PRIMARY KEY NOT NULL,
  presence_item_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  body_excerpt TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (presence_item_id) REFERENCES presence_item(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presence_item_revision_item_rev
  ON presence_item_revision(presence_item_id, revision);

CREATE INDEX IF NOT EXISTS idx_presence_item_target_observed_active
  ON presence_item(source_target_id, observed_at DESC)
  WHERE is_tombstone = 0;

CREATE INDEX IF NOT EXISTS idx_presence_poll_cursor_success
  ON presence_poll_cursor(last_success_at DESC);
