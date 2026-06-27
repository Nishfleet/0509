-- Remove the retired secondary billing provider from the live schema.
--
-- D1 migrations are append-only in production, so historical provider setup
-- migrations remain in the ledger and this final cleanup converges the current
-- remote and fresh-start schemas after the compatible Worker is deployed.

DROP TABLE IF EXISTS razorpay_webhook_event;

CREATE TABLE user_plan_next (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  dodo_payment_id TEXT,
  dodo_product_id TEXT,
  dodo_status TEXT,
  dodo_subscription_id TEXT,
  dodo_customer_id TEXT,
  dodo_next_billing_at TEXT,
  evidence_entitlement_anchor TEXT,
  evidence_entitlement_anchor_source TEXT,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

INSERT INTO user_plan_next (
  user_id,
  plan,
  plan_updated_at,
  dodo_payment_id,
  dodo_product_id,
  dodo_status,
  dodo_subscription_id,
  dodo_customer_id,
  dodo_next_billing_at,
  evidence_entitlement_anchor,
  evidence_entitlement_anchor_source
)
SELECT
  user_id,
  plan,
  plan_updated_at,
  dodo_payment_id,
  dodo_product_id,
  dodo_status,
  dodo_subscription_id,
  dodo_customer_id,
  dodo_next_billing_at,
  evidence_entitlement_anchor,
  evidence_entitlement_anchor_source
FROM user_plan;

DROP TABLE user_plan;

ALTER TABLE user_plan_next RENAME TO user_plan;

CREATE INDEX IF NOT EXISTS idx_user_plan_dodo_payment_id
  ON user_plan(dodo_payment_id);

CREATE INDEX IF NOT EXISTS idx_user_plan_dodo_subscription_id
  ON user_plan(dodo_subscription_id);

CREATE INDEX IF NOT EXISTS idx_user_plan_dodo_customer_id
  ON user_plan(dodo_customer_id);
