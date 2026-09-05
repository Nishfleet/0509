-- Throttle cron-failure operator alerts so a repeating scheduled-task failure
-- emails at most once per task per 6h window (see cron-failure-alert.server.ts).
CREATE TABLE IF NOT EXISTS cron_failure_alert_throttle (
  task_key TEXT PRIMARY KEY NOT NULL,
  last_alerted_at TEXT NOT NULL,
  last_error TEXT,
  alert_count INTEGER NOT NULL DEFAULT 1
);
