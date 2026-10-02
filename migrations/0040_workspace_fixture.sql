-- 0040_workspace_fixture.sql — durable marker for e2e fixture workspaces (#5774).
--
-- The nightly standing cron skips fixture = 1. ensureWorkspace sets it when a
-- per-run e2e+ address creates its workspace; the six fixed journey accounts
-- (app/lib/fixture-accounts.ts) stay 0 so they keep rolling over.
ALTER TABLE workspace ADD COLUMN fixture INTEGER NOT NULL DEFAULT 0 CHECK (fixture IN (0, 1));
UPDATE workspace SET fixture = 1
WHERE owner_user_id IN (
  SELECT id FROM "user"
  WHERE email LIKE 'e2e+%@0509.io'
    AND email NOT IN (
      'e2e+j7@0509.io',
      'e2e+j8-hard-v2@0509.io',
      'e2e+j8-soft-v2@0509.io',
      'e2e+j9-mentions@0509.io',
      'e2e+j12-rollovers@0509.io',
      'e2e+soak@0509.io'
    )
);
