-- Link user_plan rows to the live Dodo subscription so renewals can refresh
-- the plan, the billing page can show the real renewal date, and the
-- customer-portal flow can resolve the Dodo customer. Additive only.
ALTER TABLE user_plan ADD COLUMN dodo_subscription_id TEXT;
ALTER TABLE user_plan ADD COLUMN dodo_customer_id TEXT;
ALTER TABLE user_plan ADD COLUMN dodo_next_billing_at TEXT;
