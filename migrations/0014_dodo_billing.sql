ALTER TABLE user_plan ADD COLUMN dodo_customer_id TEXT;
ALTER TABLE user_plan ADD COLUMN dodo_subscription_id TEXT;
ALTER TABLE user_plan ADD COLUMN dodo_product_id TEXT;
ALTER TABLE user_plan ADD COLUMN dodo_checkout_session_id TEXT;
ALTER TABLE user_plan ADD COLUMN dodo_status TEXT;

CREATE INDEX idx_user_plan_dodo_subscription_id
  ON user_plan(dodo_subscription_id);

CREATE INDEX idx_user_plan_dodo_checkout_session_id
  ON user_plan(dodo_checkout_session_id);

CREATE TABLE dodo_webhook_event (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  subscription_id TEXT,
  user_id TEXT,
  received_at TEXT NOT NULL,
  payload_created_at TEXT,
  processed_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('received', 'processed', 'ignored', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_dodo_webhook_event_subscription
  ON dodo_webhook_event(subscription_id, received_at);

CREATE INDEX idx_dodo_webhook_event_user
  ON dodo_webhook_event(user_id, received_at);
