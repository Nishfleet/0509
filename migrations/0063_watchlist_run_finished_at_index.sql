-- Digest heartbeat stats now bound successful runs by completion time so
-- delayed scans count in the digest window that can honestly report them.
CREATE INDEX IF NOT EXISTS idx_watchlist_run_status_finished
  ON watchlist_run(status, finished_at DESC)
  WHERE finished_at IS NOT NULL;
