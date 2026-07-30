-- A rejected page must not erase the last accepted-page throttle state.
-- Keep the most recent failed attempt and a bounded aggregate count alongside
-- the existing accepted alert timestamp/count.
ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN last_failed_at TEXT;

ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0
  CHECK (failed_count >= 0);

-- Before this split, rejected email attempts incremented alert_count and used
-- last_alerted_at as their only timestamp. Move that legacy evidence into the
-- failure columns so accepted-page counts start honestly at zero.
UPDATE cron_failure_alert_throttle
SET
  last_failed_at = last_alerted_at,
  failed_count = MIN(alert_count, 1000000),
  alert_count = 0
WHERE last_error = 'operator_alert_not_sent';
