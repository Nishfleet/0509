-- Speed up Dodo webhook reconciliation lookups by payment, subscription, and customer id.
CREATE INDEX IF NOT EXISTS idx_user_plan_dodo_payment_id
  ON user_plan(dodo_payment_id);

CREATE INDEX IF NOT EXISTS idx_user_plan_dodo_subscription_id
  ON user_plan(dodo_subscription_id);

CREATE INDEX IF NOT EXISTS idx_user_plan_dodo_customer_id
  ON user_plan(dodo_customer_id);
