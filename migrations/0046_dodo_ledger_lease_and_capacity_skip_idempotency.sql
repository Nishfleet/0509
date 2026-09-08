-- Recoverable Dodo webhook processing leases and idempotent capacity-skip runs.
ALTER TABLE dodo_webhook_event ADD COLUMN processing_started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_dodo_webhook_event_processing_started
  ON dodo_webhook_event(processing_started_at)
  WHERE outcome IN ('received', 'processing');

ALTER TABLE watchlist_run ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_run_idempotency_key
  ON watchlist_run(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
