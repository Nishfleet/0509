-- 0509#4096: when the customer tapped Start watching on /onboarding/competitors; NULL until then. Expand-only.
ALTER TABLE onboarding_run ADD COLUMN watching_started_at TEXT;
