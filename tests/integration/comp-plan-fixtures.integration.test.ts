import { env, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { isSubscriptionLive } from "../../app/lib/billing/entitlements";
import { readDiscoverableWorkspaces } from "../../app/lib/data/entity.server";
import { readPlanSummary } from "../../app/lib/data/plan.server";
import { FIXTURE_ACCOUNTS } from "../../app/lib/fixture-accounts";

const NOW = "2026-10-06T12:00:00.000Z";

const FIXTURE_EMAILS: readonly string[] = Object.values(FIXTURE_ACCOUNTS).map((account) => account.email);
const CREATED_BY_MIGRATION: readonly string[] = [
  FIXTURE_ACCOUNTS.onboardedDesktop.email,
  FIXTURE_ACCOUNTS.onboardedPhone.email,
  FIXTURE_ACCOUNTS.j6Desktop.email,
  FIXTURE_ACCOUNTS.j6Phone.email,
  FIXTURE_ACCOUNTS.j11.email,
];
const ALREADY_IN_PRODUCTION = FIXTURE_EMAILS.filter((email) => !CREATED_BY_MIGRATION.includes(email));
const NOT_FIXTURES = ["someone@gymshark.com", "e2e+j3-0123456789ab@0509.io", "e2e+j8-hard@0509.io"];

const OWNER_WORKSPACE_ID = "ws_8Cy70xhxaDezyg0UCi3DkHeKXk1FTs94";

const COMP_MIGRATION: D1Migration | undefined = env.TEST_MIGRATIONS.find((migration) =>
  migration.name.endsWith("_comp_plan_fixture_workspaces.sql"),
);

interface PlanRow {
  email: string;
  workspace_id: string;
  id: string;
  tier: string;
  status: string;
  provider: string;
  provider_subscription_id: string | null;
  updated_at: string;
}

const SELECT_PLANS = `SELECT u.email AS email, p.workspace_id, p.id, p.tier, p.status, p.provider, p.provider_subscription_id, p.updated_at
FROM plan p JOIN workspace w ON w.id = p.workspace_id JOIN "user" u ON u.id = w.owner_user_id
ORDER BY u.email`;

async function seed(email: string, index: number): Promise<string> {
  const userId = `user-comp-${String(index)}`;
  const workspaceId = `ws-comp-${String(index)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, email, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Acme', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
  ]);
  return workspaceId;
}

async function seedSelf(workspaceId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'self', ?3, 'Self', ?4)",
  )
    .bind(`self-${workspaceId}`, workspaceId, `${workspaceId}.example`, NOW)
    .run();
}

async function applyComp(): Promise<void> {
  if (COMP_MIGRATION === undefined) throw new Error("the comp plan migration is missing");
  await env.DB.batch(COMP_MIGRATION.queries.map((query) => env.DB.prepare(query)));
}

async function planRows(): Promise<PlanRow[]> {
  const { results } = await env.DB.prepare(SELECT_PLANS).all<PlanRow>();
  return results;
}

async function workspaceIdOf(email: string): Promise<string> {
  const row = await env.DB.prepare(
    'SELECT w.id AS id FROM workspace w JOIN "user" u ON u.id = w.owner_user_id WHERE u.email = ?',
  )
    .bind(email)
    .first<{ id: string }>();
  if (row === null) throw new Error(`no workspace for ${email}`);
  return row.id;
}

describe("the comp plan migration for kept fixture workspaces", () => {
  beforeEach(async () => {
    const emails = [...FIXTURE_EMAILS, ...NOT_FIXTURES, "owner-workspace@example.com"];
    await env.DB.prepare(`DELETE FROM "user" WHERE email IN (${emails.map(() => "?").join(", ")})`)
      .bind(...emails)
      .run();
  });

  it("gives every FIXTURE_ACCOUNTS workspace an active comp starter plan and no other workspace one", async () => {
    await Promise.all([...ALREADY_IN_PRODUCTION, ...NOT_FIXTURES].map((email, index) => seed(email, index)));

    await applyComp();

    const rows = await planRows();
    expect(rows.map((row) => row.email)).toEqual([...FIXTURE_EMAILS].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        id: `comp-${row.workspace_id}`,
        tier: "starter",
        status: "active",
        provider: "comp",
        provider_subscription_id: null,
      });
    }
  });

  it("creates each missing production-lane identity with the workspace ensureWorkspace would create", async () => {
    await applyComp();

    const { results } = await env.DB.prepare(
      `SELECT u.id AS user_id, u.email AS email, u.emailVerified AS verified, w.id AS workspace_id, w.name AS name, w.fixture AS fixture
       FROM "user" u JOIN workspace w ON w.owner_user_id = u.id WHERE u.email IN (${CREATED_BY_MIGRATION.map(() => "?").join(", ")})
       ORDER BY u.email`,
    )
      .bind(...CREATED_BY_MIGRATION)
      .all<{ user_id: string; email: string; verified: number; workspace_id: string; name: string; fixture: number }>();
    expect(results.map((row) => row.email)).toEqual([...CREATED_BY_MIGRATION].sort());
    for (const row of results) {
      expect(row.workspace_id).toBe(`ws_${row.user_id}`);
      expect(row.name).toBe(row.email.slice(0, row.email.indexOf("@")));
      expect(row.verified).toBe(0);
      expect(row.fixture).toBe(0);
    }
  });

  it("keeps an identity that signed in before it ran, and gives that workspace the comp plan", async () => {
    const workspaceId = await seed(FIXTURE_ACCOUNTS.j11.email, 0);

    await applyComp();

    const { results } = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?')
      .bind(FIXTURE_ACCOUNTS.j11.email)
      .all<{ id: string }>();
    expect(results).toEqual([{ id: "user-comp-0" }]);
    expect(await workspaceIdOf(FIXTURE_ACCOUNTS.j11.email)).toBe(workspaceId);
    expect((await planRows()).find((row) => row.email === FIXTURE_ACCOUNTS.j11.email)?.workspace_id).toBe(workspaceId);
  });

  it("is read as a live, unbilled Starter plan", async () => {
    const workspaceId = await seed(FIXTURE_ACCOUNTS.j8Hard.email, 0);

    await applyComp();

    expect(await readPlanSummary(workspaceId)).toEqual({
      tier: "starter",
      status: "active",
      currentPeriodEnd: null,
      trialing: false,
      billed: false,
    });
  });

  it("makes the soak and fixture workspaces eligible for the weekly discovery refresh", async () => {
    const soak = await seed(FIXTURE_ACCOUNTS.soak.email, 0);
    const j8 = await seed(FIXTURE_ACCOUNTS.j8Hard.email, 1);
    const customer = await seed("someone@gymshark.com", 2);
    await Promise.all([soak, j8, customer].map((workspaceId) => seedSelf(workspaceId)));

    expect((await readDiscoverableWorkspaces()).map((row) => row.workspaceId)).not.toContain(soak);

    await applyComp();

    const live = (await readDiscoverableWorkspaces())
      .filter((row) => isSubscriptionLive(row, new Date()))
      .map((row) => row.workspaceId);
    expect(live).toContain(soak);
    expect(live).toContain(j8);
    expect(live).not.toContain(customer);
  });

  it("gives the owner's workspace, named by id, a live comp Agency plan for a year", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO \"user\" (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('user-comp-owner', 'Owner', 'owner-workspace@example.com', 1, ?1, ?1)",
      ).bind(NOW),
      env.DB.prepare(
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Owner', 'user-comp-owner', 'UTC', 1, 8, ?2)",
      ).bind(OWNER_WORKSPACE_ID, NOW),
    ]);

    await applyComp();
    await applyComp();

    expect((await planRows()).filter((row) => row.workspace_id === OWNER_WORKSPACE_ID)).toEqual([
      {
        email: "owner-workspace@example.com",
        workspace_id: OWNER_WORKSPACE_ID,
        id: `comp-${OWNER_WORKSPACE_ID}`,
        tier: "agency",
        status: "active",
        provider: "comp",
        provider_subscription_id: null,
        updated_at: "2026-10-06T00:00:00.000Z",
      },
    ]);
    expect(await readPlanSummary(OWNER_WORKSPACE_ID)).toEqual({
      tier: "agency",
      status: "active",
      currentPeriodEnd: "2027-10-06T00:00:00.000Z",
      trialing: false,
      billed: false,
    });
  });

  it("is a no-op when run again", async () => {
    await Promise.all(ALREADY_IN_PRODUCTION.map((email, index) => seed(email, index)));

    await applyComp();
    const first = await planRows();
    const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM "user"').first<{ n: number }>();
    await applyComp();

    expect(first).toHaveLength(FIXTURE_EMAILS.length);
    expect(await planRows()).toEqual(first);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM "user"').first<{ n: number }>()).toEqual(users);
  });

  it("leaves an existing plan row untouched", async () => {
    const workspaceId = await seed(FIXTURE_ACCOUNTS.soak.email, 0);
    await env.DB.prepare(
      "INSERT INTO plan (id, workspace_id, tier, status, provider_subscription_id, updated_at) VALUES ('paid-comp-0', ?1, 'agency', 'active', 'sub_1', ?2)",
    )
      .bind(workspaceId, NOW)
      .run();

    await applyComp();

    expect((await planRows()).find((row) => row.email === FIXTURE_ACCOUNTS.soak.email)).toEqual({
      email: FIXTURE_ACCOUNTS.soak.email,
      workspace_id: workspaceId,
      id: "paid-comp-0",
      tier: "agency",
      status: "active",
      provider: "dodo",
      provider_subscription_id: "sub_1",
      updated_at: NOW,
    });
  });
});
