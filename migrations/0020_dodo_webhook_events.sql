-- Ledger of received Dodo webhook events. Gives billing disputes an audit
-- trail, dedupes redelivered events, and lets failed processing be retried
-- safely.
CREATE TABLE IF NOT EXISTS dodo_webhook_event (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload_timestamp TEXT,
  processed_at TEXT,
  outcome TEXT NOT NULL DEFAULT 'received',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_dodo_webhook_event_user
  ON dodo_webhook_event(user_id, received_at);

CREATE INDEX IF NOT EXISTS idx_dodo_webhook_event_type
  ON dodo_webhook_event(event_type, received_at);
