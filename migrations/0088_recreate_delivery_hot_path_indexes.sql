-- Recreate the seven delivery hot-path indexes that migration 0075 dropped
-- and never recreated (issue #2249, defect C).
--
-- 0075_teams_delivery.sql rebuilt both delivery_target and delivery_attempt
-- (DROP TABLE + ALTER TABLE ... RENAME TO) but only recreated three indexes:
--   idx_delivery_target_user_watchlist_channel
--   idx_delivery_target_channel_value
--   idx_delivery_attempt_target_channel_created
-- The other seven indexes defined across 0022 and 0067 were lost, so every
-- per-user / per-watchlist / digest-run / provider-reconciliation / billing-
-- lifecycle query against delivery_attempt full-scans, and watchlist-scoped
-- delivery_target lookups full-scan.
--
-- This migration is additive only: CREATE INDEX IF NOT EXISTS with the
-- original column lists and partial-index predicates, read from the
-- migrations that first defined them (0022_hot_path_indexes.sql and
-- 0067_delivery_recovery_and_digest_jobs.sql). It does not edit 0075 or any
-- already-applied migration. Idempotent on re-apply.

-- delivery_target: watchlist-scoped delivery target lookup (0022).
CREATE INDEX IF NOT EXISTS idx_delivery_target_watchlist
  ON delivery_target(watchlist_id) WHERE watchlist_id IS NOT NULL;

-- delivery_attempt: WhatsApp status webhook reconciliation (0022).
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_provider_message
  ON delivery_attempt(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- delivery_attempt: per-user list views (0022).
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_user_created
  ON delivery_attempt(user_id, created_at DESC);

-- delivery_attempt: per-watchlist list views (0022).
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_watchlist_created
  ON delivery_attempt(watchlist_id, created_at DESC)
  WHERE watchlist_id IS NOT NULL;

-- delivery_attempt: digest-run lookups (0022).
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_digest_run
  ON delivery_attempt(digest_run_id)
  WHERE digest_run_id IS NOT NULL;

-- delivery_attempt: failure dashboards / status selectors (0022).
CREATE INDEX IF NOT EXISTS idx_delivery_attempt_status_created
  ON delivery_attempt(status, created_at DESC);

-- delivery_attempt: billing lifecycle recovery outbox selector (0067).
-- Keeps the bounded selector on its small email-outbox subset instead of
-- scanning unrelated 180-day delivery history.
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
