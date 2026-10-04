-- 0039_plan_trialing.sql — remember whether a subscription is still in its trial.
--
-- Dodo reports a trial subscription as status "active" and has no trialing
-- status, so the webhook handler stores whether next_billing_date still falls
-- inside the trial window. Rows written before this read as not trialing.
ALTER TABLE plan ADD COLUMN trialing INTEGER NOT NULL DEFAULT 0;
