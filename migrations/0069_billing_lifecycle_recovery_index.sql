-- Billing lifecycle recovery runs on every cron. Keep the bounded selector on
-- its small email-outbox subset instead of scanning unrelated 180-day delivery
-- history. 0067 and 0068 are owned by the integration line and land before this
-- additive index in the combined release candidate.
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
