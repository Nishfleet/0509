-- Plan-aware monitoring queue priority on durable orchestrated runs.
ALTER TABLE watchlist_run ADD COLUMN queue_priority INTEGER NOT NULL DEFAULT 2;

CREATE INDEX IF NOT EXISTS idx_watchlist_run_queue_priority_pending
  ON watchlist_run(queue_priority, queued_at, id)
  WHERE status = 'pending';
