CREATE TABLE IF NOT EXISTS razorpay_webhook_event (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  subscription_id TEXT,
  user_id TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload_created_at TEXT,
  processed_at TEXT,
  outcome TEXT NOT NULL DEFAULT 'received',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_event_subscription
  ON razorpay_webhook_event(subscription_id, received_at);

CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_event_user
  ON razorpay_webhook_event(user_id, received_at);
