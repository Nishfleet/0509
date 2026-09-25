-- 0024_sweep_run.sql — sweep wall clock and coverage (parent #4118).
--
-- Every finished site sweep writes one sweep_run row: the planned time, the
-- finish time, the measured wall clock in ms, the page count and the failed
-- count, so a cap decision starts with arithmetic instead of estimates.
-- app/lib/data/sweep_run.server.ts writes the row.
--
-- Expand-only: a new table plus its index, so the previous Worker version
-- (which never reads sweep_run) keeps working unchanged. No DROP, no ALTER,
-- no rename, so a code rollback stays safe.

CREATE TABLE sweep_run (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, planned_at TEXT NOT NULL, finished_at TEXT NOT NULL, wall_ms INTEGER NOT NULL, pages INTEGER NOT NULL, failed INTEGER NOT NULL);
CREATE INDEX idx_sweep_run_kind_time ON sweep_run(kind, finished_at);
