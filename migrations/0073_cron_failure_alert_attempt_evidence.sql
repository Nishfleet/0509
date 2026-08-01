-- A rejected page must not erase the last accepted-page throttle state.
-- Keep the most recent failed attempt and a bounded aggregate count alongside
-- the existing accepted alert timestamp/count.
ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN last_failed_at TEXT;

ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN failed_count INTEGER NOT NULL DEFAULT 0
  CHECK (failed_count >= 0);

ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN last_alert_window INTEGER;

ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN accepted_count_baseline INTEGER NOT NULL DEFAULT 0
  CHECK (accepted_count_baseline >= 0);

ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN last_pending_at TEXT;

ALTER TABLE cron_failure_alert_throttle
  ADD COLUMN pending_alert_window INTEGER;

-- Before this split, rejected email attempts incremented alert_count and used
-- last_alerted_at as their only timestamp. Move that legacy evidence into the
-- failure columns so accepted-page counts start honestly at zero.
UPDATE cron_failure_alert_throttle
SET
  last_failed_at = CASE
    WHEN julianday(last_alerted_at) IS NOT NULL
      AND julianday(last_alerted_at) <= julianday('now')
    THEN last_alerted_at
    ELSE NULL
  END,
  failed_count = CASE
    WHEN julianday(last_alerted_at) IS NOT NULL
      AND julianday(last_alerted_at) <= julianday('now')
    THEN MIN(alert_count, 1000000)
    ELSE 0
  END,
  alert_count = 0
WHERE last_error = 'operator_alert_not_sent';

-- Bind existing accepted evidence to the same six-hour idempotency window used
-- by the sender so concurrent repair writers cannot count one page twice.
UPDATE cron_failure_alert_throttle
SET last_alert_window = CAST(strftime('%s', last_alerted_at) AS INTEGER) / 21600
WHERE last_error = 'operator_alert_sent'
  AND julianday(last_alerted_at) IS NOT NULL
  AND julianday(last_alerted_at) <= julianday('now');

-- Older rows retain only the latest accepted window. Preserve the earlier
-- aggregate as a baseline, then use one unique row per newly observed window
-- so duplicate repair writers cannot increment the accepted count twice.
UPDATE cron_failure_alert_throttle
SET accepted_count_baseline = MAX(alert_count - 1, 0)
WHERE last_error = 'operator_alert_sent'
  AND last_alert_window IS NOT NULL;

CREATE TABLE cron_failure_alert_accepted_window (
  task_key TEXT NOT NULL,
  alert_window INTEGER NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (task_key, alert_window)
);

INSERT OR IGNORE INTO cron_failure_alert_accepted_window (
  task_key, alert_window, accepted_at
)
SELECT task_key, last_alert_window, last_alerted_at
FROM cron_failure_alert_throttle
WHERE last_error = 'operator_alert_sent'
  AND last_alert_window IS NOT NULL;
