-- Durable scheduled-digest queue. The cron creates one idempotent row per
-- workspace and period, then drains a bounded set. Interrupted work is
-- reclaimed by lease rather than disappearing with the cron invocation.
CREATE TABLE IF NOT EXISTS digest_schedule_job (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'exhausted')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  processing_token TEXT,
  processing_started_at TEXT,
  completed_at TEXT,
  last_error_code TEXT,
  exhausted_at TEXT,
  exhaustion_alert_token TEXT,
  exhaustion_alert_started_at TEXT,
  exhaustion_alerted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  UNIQUE (user_id, cadence, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_digest_schedule_job_recovery
  ON digest_schedule_job(status, period_end, user_id);

CREATE INDEX IF NOT EXISTS idx_digest_schedule_job_running
  ON digest_schedule_job(processing_started_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_digest_schedule_job_exhaustion_alert
  ON digest_schedule_job(exhaustion_alerted_at, exhaustion_alert_started_at)
  WHERE status = 'exhausted';

-- Billing lifecycle recovery runs on every cron. Keep the bounded selector on
-- its small email-outbox subset instead of scanning unrelated 180-day delivery
-- history.
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_billing_lifecycle_status_updated
  ON delivery_attempt(status, webhook_status, updated_at)
  WHERE lane = 'customer'
    AND channel = 'email'
    AND watchlist_id IS NULL
    AND digest_run_id IS NULL
    AND delivery_target_id IS NULL
    AND (
      idempotency_key LIKE 'billing-payment-issue:%'
      OR idempotency_key LIKE 'billing-cancellation:%'
      OR idempotency_key LIKE 'billing-refund:%'
    );
