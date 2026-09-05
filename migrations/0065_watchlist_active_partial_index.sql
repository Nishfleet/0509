-- Hot cron path filters active watchlists; a partial index avoids scanning
-- paused rows when listing scheduled monitoring targets.
CREATE INDEX IF NOT EXISTS idx_watchlist_active_partial
  ON watchlist(is_active)
  WHERE is_active = 1;
