-- Durable orchestration metadata for per-watchlist monitoring fan-out.
ALTER TABLE watchlist_run ADD COLUMN workflow_instance_id TEXT;
ALTER TABLE watchlist_run ADD COLUMN processing_token TEXT;
ALTER TABLE watchlist_run ADD COLUMN processing_started_at TEXT;
ALTER TABLE watchlist_run ADD COLUMN queued_at TEXT;
ALTER TABLE watchlist_run ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watchlist_run ADD COLUMN retry_after TEXT;

CREATE INDEX IF NOT EXISTS idx_watchlist_run_orchestration_pending
  ON watchlist_run(status, queued_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_watchlist_run_orchestration_running
  ON watchlist_run(processing_started_at)
  WHERE status = 'running';
