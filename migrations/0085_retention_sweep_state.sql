-- R2 -> D1 orphan reconciliation walks the landing-pages/ bucket one bounded
-- page per six-hourly sweep tick. The R2 list cursor must survive between
-- ticks so a single sweep never walks the whole bucket; it is persisted here
-- as a single aggregate row. The cursor is an opaque R2 token and contains no
-- customer or provider data. The mode records whether the last run was a
-- dry-run or a live delete so the delete path can reset the cursor when it is
-- first enabled after a dry-run walk.
CREATE TABLE IF NOT EXISTS retention_sweep_state (
  state_id TEXT PRIMARY KEY NOT NULL CHECK (state_id = 'r2_orphan_reconcile_cursor'),
  cursor_value TEXT,
  mode TEXT NOT NULL DEFAULT 'dry-run' CHECK (mode IN ('dry-run', 'delete')),
  updated_at TEXT NOT NULL
);
