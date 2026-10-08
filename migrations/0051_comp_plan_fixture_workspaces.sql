-- Complimentary Starter plans for the kept production e2e fixture workspaces (#7217, #7219).
--
-- Production has no plan rows. Once the app, the sweeps and email are gated on a live plan, every
-- fixture workspace falls dark: J8 (own-site alerts) stops, and the weekly discovery refresh, which
-- already joins plan (3aa9018b4), never starts for the #4730 soak workspace.
--
-- The emails are exactly FIXTURE_ACCOUNTS in app/lib/fixture-accounts.ts; the integration test fails
-- if the two lists drift. No personal or customer account is named here.
--
-- Step 1 creates the five production-lane identities that do not exist yet (the onboarded.setup lanes,
-- the two J6 widths, J11) the way a first magic-link sign-in would: a "user" row, then the workspace
-- ensureWorkspace would create, id ws_<user id>, named after the local part, fixture 0. A first
-- sign-in later finds both and verifies the address. Existing accounts are untouched.
INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
VALUES
  ('e2e-kept-onboarded-desktop', 'e2e+onboarded-desktop@0509.io', 'e2e+onboarded-desktop@0509.io', 0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  ('e2e-kept-onboarded-phone', 'e2e+onboarded-phone@0509.io', 'e2e+onboarded-phone@0509.io', 0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  ('e2e-kept-j6-desktop', 'e2e+j6-desktop@0509.io', 'e2e+j6-desktop@0509.io', 0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  ('e2e-kept-j6-phone', 'e2e+j6-phone@0509.io', 'e2e+j6-phone@0509.io', 0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z'),
  ('e2e-kept-j11', 'e2e+j11@0509.io', 'e2e+j11@0509.io', 0, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z')
ON CONFLICT DO NOTHING;

INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture)
SELECT 'ws_' || u.id, substr(u.email, 1, instr(u.email, '@') - 1), u.id, 'UTC', 1, 8, '2026-10-06T00:00:00.000Z', 0
FROM "user" u
WHERE u.email IN (
  'e2e+onboarded-desktop@0509.io',
  'e2e+onboarded-phone@0509.io',
  'e2e+j6-desktop@0509.io',
  'e2e+j6-phone@0509.io',
  'e2e+j11@0509.io'
)
  AND NOT EXISTS (SELECT 1 FROM workspace w WHERE w.owner_user_id = u.id);

-- Step 2: one comp plan per fixture workspace. provider 'comp' has no CHECK constraint and no app code
-- reads provider; status 'active' is a paid status in app/lib/billing/entitlements.ts, so readPlan
-- entitles the stored tier and the discovery join sees the workspace. With no
-- provider_subscription_id, a Dodo webhook reaches this row only through a proven checkout started
-- from that workspace. ON CONFLICT DO NOTHING leaves any existing plan row as it is, so a re-run is
-- a no-op.
INSERT INTO plan (id, workspace_id, tier, status, provider, updated_at)
SELECT 'comp-' || w.id, w.id, 'starter', 'active', 'comp', '2026-10-06T00:00:00.000Z'
FROM workspace w
JOIN "user" u ON u.id = w.owner_user_id
WHERE u.email IN (
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
ON CONFLICT(workspace_id) DO NOTHING;

-- Step 3: the product owner's own workspace, named by id only (Nish, 2026-10-06: the top plan, annual).
-- agency is the top tier in app/lib/billing/plans.ts. plan has no billing-interval column (the
-- interval lives only in the Dodo product id), so annual is current_period_end one year after this
-- migration. limits_json stays '{}' like the fixture rows, so resolveEntitlements reads the agency
-- limits from the tier. Same DO NOTHING rule as step 2.
INSERT INTO plan (id, workspace_id, tier, status, provider, current_period_end, trialing, limits_json, updated_at)
SELECT 'comp-' || w.id, w.id, 'agency', 'active', 'comp', '2027-10-06T00:00:00.000Z', 0, '{}', '2026-10-06T00:00:00.000Z'
FROM workspace w
WHERE w.id = 'ws_8Cy70xhxaDezyg0UCi3DkHeKXk1FTs94'
ON CONFLICT(workspace_id) DO NOTHING;
