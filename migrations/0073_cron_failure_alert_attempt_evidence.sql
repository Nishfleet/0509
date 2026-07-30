-- A rejected page must not erase the last accepted-page throttle state.
-- Keep the most recent failed attempt and a bounded aggregate count alongside
-- the existing accepted alert timestamp/count.
ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN last_failed_at TEXT;

ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0
  CHECK (failed_count >= 0);
