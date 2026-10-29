-- 0069_mark_kept_fixture_workspaces.sql — the kept e2e accounts become fixtures (#7757).
--
-- 0040 left the six fixed journey accounts at fixture = 0 so their scheduled runs kept rolling
-- over, and 0051 created five more kept identities at fixture = 0 for the same reason. The
-- scheduled runs moved to their own site (fleet-ops#9930), so the production workspaces the tests
-- sign into are now test data: the nightly sweeps and the AI lanes must skip them.
--
-- The emails are exactly FIXTURE_ACCOUNTS in app/lib/fixture-accounts.ts, which
-- app/lib/workspace.server.ts already marks for every workspace created from here on; the
-- integration test fails if this list and that constant drift. Reversing this is one new
-- migration setting the rows back to 0.
UPDATE workspace SET fixture = 1
WHERE fixture = 0
  AND owner_user_id IN (
    SELECT id FROM "user"
    WHERE email IN (
      'e2e+j7@0509.io',
      'e2e+j8-hard-v2@0509.io',
      'e2e+j8-soft-v2@0509.io',
      'e2e+j9-mentions@0509.io',
      'e2e+j12-rollovers@0509.io',
      'e2e+soak@0509.io',
      'e2e+onboarded-desktop@0509.io',
      'e2e+onboarded-phone@0509.io',
      'e2e+j6-desktop@0509.io',
      'e2e+j6-phone@0509.io',
      'e2e+j11@0509.io'
    )
  );