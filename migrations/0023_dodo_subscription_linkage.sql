-- Link user_plan rows to the live Dodo subscription so renewals can refresh
-- the plan, the billing page can show the real renewal date, and the
-- customer-portal flow can resolve the Dodo customer.
--
-- This is a table REBUILD rather than ALTERs because remote D1 carried
-- out-of-band drift columns (dodo_subscription_id, dodo_customer_id,
-- dodo_checkout_session_id — all verified empty on 2026-06-12) that local
-- migrations never created; plain ADD COLUMN fails remotely with "duplicate
-- column". The rebuild converges both environments on one canonical schema.
-- The INSERT below selects only columns that exist in BOTH schemas.

CREATE TABLE user_plan_next (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  dodo_payment_id TEXT,
  dodo_product_id TEXT,
  dodo_status TEXT,
  dodo_subscription_id TEXT,
  dodo_customer_id TEXT,
  dodo_next_billing_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

INSERT INTO user_plan_next (
  user_id,
  plan,
  stripe_customer_id,
  stripe_subscription_id,
  plan_updated_at,
  dodo_payment_id,
  dodo_product_id,
  dodo_status
)
SELECT
  user_id,
  plan,
  stripe_customer_id,
  stripe_subscription_id,
  plan_updated_at,
  dodo_payment_id,
  dodo_product_id,
  dodo_status
FROM user_plan;

DROP TABLE user_plan;

ALTER TABLE user_plan_next RENAME TO user_plan;
