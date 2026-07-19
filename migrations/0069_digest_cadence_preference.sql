-- Customer preference for digest cadence (plan default vs weekly-only).
-- plan_default keeps current plan-driven daily+weekly behavior.
-- weekly_only skips daily digest jobs for plans that otherwise receive them.
ALTER TABLE workspace_delivery_config
  ADD COLUMN digest_cadence_preference TEXT NOT NULL DEFAULT 'plan_default'
  CHECK (digest_cadence_preference IN ('plan_default', 'weekly_only'));
