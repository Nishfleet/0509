ALTER TABLE user_plan ADD COLUMN razorpay_customer_id TEXT;
ALTER TABLE user_plan ADD COLUMN razorpay_subscription_id TEXT;
ALTER TABLE user_plan ADD COLUMN razorpay_plan_id TEXT;
ALTER TABLE user_plan ADD COLUMN razorpay_status TEXT;

CREATE INDEX idx_user_plan_razorpay_subscription_id
  ON user_plan(razorpay_subscription_id);
