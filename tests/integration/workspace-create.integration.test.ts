import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { insertWorkspace, WorkspaceCapError } from "../../app/lib/data/workspace.server";
import { ensureWorkspace, firstWorkspaceId, workspaceLanding } from "../../app/lib/workspace.server";

async function seedUser(id: string, email: string) {
  const now = "2026-09-22T12:00:00.000Z";
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, now, now)
    .run();
}

async function workspaceCount(ownerUserId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM workspace WHERE owner_user_id = ?")
    .bind(ownerUserId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("ensureWorkspace against migrations/0001_rebuild.sql", () => {
  it("creates one workspace and no entity or plan row", async () => {
    await seedUser("user-1", "ada@example.com");
    const row = await ensureWorkspace(env.DB, {
      userId: "user-1",
      email: "ada@example.com",
      timezone: "Asia/Kolkata",
      now: "2026-09-22T12:00:00.000Z",
    });

    expect(row).toMatchObject({
      id: firstWorkspaceId("user-1"),
      name: "ada",
      owner_user_id: "user-1",
      timezone: "Asia/Kolkata",
      brief_weekday: 1,
      brief_hour: 8,
      created_at: "2026-09-22T12:00:00.000Z",
    });
    expect(await workspaceCount("user-1")).toBe(1);
    const entity = await env.DB.prepare("SELECT count(*) AS n FROM entity").first<{ n: number }>();
    const plan = await env.DB.prepare("SELECT count(*) AS n FROM plan WHERE workspace_id = ?")
      .bind(firstWorkspaceId("user-1"))
      .first<{ n: number }>();
    expect(entity?.n).toBe(0);
    expect(plan?.n).toBe(0);
  });

  it("a second insert of the first workspace id does not create a row", async () => {
    await seedUser("user-2", "grace@example.com");
    const id = firstWorkspaceId("user-2");
    const insert = `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
      VALUES (?, 'grace', 'user-2', 'UTC', 1, 8, ?)
      ON CONFLICT(id) DO NOTHING`;
    await env.DB.prepare(insert).bind(id, "2026-09-22T12:00:00.000Z").run();
    await env.DB.prepare(insert).bind(id, "2026-09-22T12:00:01.000Z").run();
    expect(await workspaceCount("user-2")).toBe(1);
  });

  it("two overlapping ensures leave one workspace", async () => {
    await seedUser("user-3", "lin@example.com");
    const input = {
      userId: "user-3",
      email: "lin@example.com",
      timezone: "America/New_York",
      now: "2026-09-22T12:00:00.000Z",
    };
    const [first, second] = await Promise.all([
      ensureWorkspace(env.DB, input),
      ensureWorkspace(env.DB, { ...input, now: "2026-09-22T12:00:01.000Z" }),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.id).toBe(firstWorkspaceId("user-3"));
    expect(await workspaceCount("user-3")).toBe(1);
  });

  it("a later brand can be a second workspace for the same owner", async () => {
    await seedUser("user-4", "owen@example.com");
    const first = await ensureWorkspace(env.DB, {
      userId: "user-4",
      email: "owen@example.com",
      timezone: "UTC",
      now: "2026-09-22T12:00:00.000Z",
    });
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES ('brand-2', 'second', 'user-4', 'UTC', 1, 8, '2026-09-23T12:00:00.000Z')`,
    ).run();
    const again = await ensureWorkspace(env.DB, {
      userId: "user-4",
      email: "owen@example.com",
      timezone: "UTC",
      now: "2026-09-24T12:00:00.000Z",
    });
    expect(again.id).toBe(first.id);
    expect(await workspaceCount("user-4")).toBe(2);
  });

  it("falls back to the Scout cap for an owner with no plan rows", async () => {
    await seedUser("user-no-plans", "no-plans@example.com");
    const create = (id: string) =>
      insertWorkspace(env.DB, {
        id,
        name: id,
        ownerUserId: "user-no-plans",
        timezone: "UTC",
        createdAt: "2026-09-23T12:00:00.000Z",
        fixture: false,
      });
    const plans = await env.DB.prepare(
      "SELECT count(*) AS n FROM plan WHERE workspace_id IN (SELECT id FROM workspace WHERE owner_user_id = ?)",
    )
      .bind("user-no-plans")
      .first<{ n: number }>();
    expect(plans?.n).toBe(0);

    await create("ws-no-plans-first");
    await expect(create("ws-no-plans-second")).rejects.toThrow(WorkspaceCapError);
    expect(await workspaceCount("user-no-plans")).toBe(1);
  });

  it("lets exactly one of two concurrent creates through at cap minus one", async () => {
    await seedUser("user-race-cap", "race-cap@example.com");
    const create = (id: string) =>
      insertWorkspace(env.DB, {
        id,
        name: id,
        ownerUserId: "user-race-cap",
        timezone: "UTC",
        createdAt: "2026-09-23T12:00:00.000Z",
        fixture: false,
      });

    const outcomes = await Promise.allSettled([create("ws-race-a"), create("ws-race-b")]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const refused = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toBeInstanceOf(WorkspaceCapError);
    expect(await workspaceCount("user-race-cap")).toBe(1);
  });

  it("refuses a second workspace on Scout and allows a second on Agency", async () => {
    await seedUser("user-scout-cap", "scout-cap@example.com");
    await seedUser("user-agency-cap", "agency-cap@example.com");
    const now = "2026-09-22T12:00:00.000Z";
    await ensureWorkspace(env.DB, {
      userId: "user-scout-cap",
      email: "scout-cap@example.com",
      timezone: "UTC",
      now,
    });
    await expect(
      insertWorkspace(env.DB, {
        id: "ws-scout-second",
        name: "second",
        ownerUserId: "user-scout-cap",
        timezone: "UTC",
        createdAt: "2026-09-23T12:00:00.000Z",
        fixture: false,
      }),
    ).rejects.toThrow(WorkspaceCapError);
    expect(await workspaceCount("user-scout-cap")).toBe(1);

    const agency = await ensureWorkspace(env.DB, {
      userId: "user-agency-cap",
      email: "agency-cap@example.com",
      timezone: "UTC",
      now,
    });
    await env.DB.prepare(
      "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?, ?, 'agency', 'active', ?)",
    )
      .bind("plan-agency-cap", agency.id, now)
      .run();
    await insertWorkspace(env.DB, {
      id: "ws-agency-second",
      name: "second",
      ownerUserId: "user-agency-cap",
      timezone: "UTC",
      createdAt: "2026-09-23T12:00:00.000Z",
      fixture: false,
    });
    expect(await workspaceCount("user-agency-cap")).toBe(2);
  });

  it("a second insert of the same id is not a cap error", async () => {
    await seedUser("user-same-id", "same-id@example.com");
    const now = "2026-09-22T12:00:00.000Z";
    const input = {
      id: "ws-same-id",
      name: "one",
      ownerUserId: "user-same-id",
      timezone: "UTC",
      createdAt: now,
      fixture: false,
    };
    await insertWorkspace(env.DB, input);
    await insertWorkspace(env.DB, { ...input, createdAt: "2026-09-23T12:00:00.000Z" });
    expect(await workspaceCount("user-same-id")).toBe(1);
  });

  it("uses the widest live plan when an older workspace is still Scout", async () => {
    await seedUser("user-wide-cap", "wide-cap@example.com");
    const now = "2026-09-22T12:00:00.000Z";
    const first = await ensureWorkspace(env.DB, {
      userId: "user-wide-cap",
      email: "wide-cap@example.com",
      timezone: "UTC",
      now,
    });
    await env.DB.prepare(
      "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?, ?, 'scout', 'active', ?)",
    )
      .bind("plan-wide-scout", first.id, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES ('ws-wide-agency', 'agency', 'user-wide-cap', 'UTC', 1, 8, ?)`,
    )
      .bind("2026-09-23T12:00:00.000Z")
      .run();
    await env.DB.prepare(
      "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?, ?, 'agency', 'active', ?)",
    )
      .bind("plan-wide-agency", "ws-wide-agency", now)
      .run();
    await insertWorkspace(env.DB, {
      id: "ws-wide-third",
      name: "third",
      ownerUserId: "user-wide-cap",
      timezone: "UTC",
      createdAt: "2026-09-24T12:00:00.000Z",
      fixture: false,
    });
    expect(await workspaceCount("user-wide-cap")).toBe(3);
  });

  it("lands on /onboarding until a self entity exists", async () => {
    await seedUser("user-5", "maya@example.com");
    const created = await ensureWorkspace(env.DB, {
      userId: "user-5",
      email: "maya@example.com",
      timezone: "UTC",
      now: "2026-09-22T12:00:00.000Z",
    });
    const input = { userId: "user-5", timezone: "UTC" };
    expect(await workspaceLanding(env.DB, input)).toEqual({
      workspaceId: created.id,
      landing: "/onboarding",
    });
    const workspaceId = firstWorkspaceId("user-5");
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, created_at)
       VALUES ('entity-5', ?, 'self', 'maya.example', '2026-09-22T12:01:00.000Z')`,
    )
      .bind(workspaceId)
      .run();
    expect(await workspaceLanding(env.DB, input)).toEqual({ workspaceId, landing: null });
    expect(await workspaceCount("user-5")).toBe(1);
    const plans = await env.DB.prepare("SELECT count(*) AS n FROM plan WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(plans?.n).toBe(0);
  });

  it("does not insert a workspace when the owner has none", async () => {
    await seedUser("user-6", "no-ws@example.com");
    expect(await workspaceLanding(env.DB, { userId: "user-6", timezone: "UTC" })).toEqual({
      workspaceId: null,
      landing: null,
    });
    expect(await workspaceCount("user-6")).toBe(0);
  });

  it("clears a workspace_deleted suppression when the same address signs up again (0509#7080)", async () => {
    await env.DB.prepare(
      `INSERT INTO email_suppression (address, reason, created_at) VALUES ('back@example.com', 'workspace_deleted', ?), ('gone@example.com', 'unsubscribed', ?)`,
    )
      .bind("2026-09-22T12:00:00.000Z", "2026-09-22T12:00:00.000Z")
      .run();
    await seedUser("user-7", "back@example.com");
    await ensureWorkspace(env.DB, {
      userId: "user-7",
      email: "back@example.com",
      timezone: "UTC",
      now: "2026-09-22T12:00:00.000Z",
    });
    const rows = await env.DB.prepare("SELECT address, reason FROM email_suppression ORDER BY address").all<{
      address: string;
      reason: string;
    }>();
    expect(rows.results).toEqual([{ address: "gone@example.com", reason: "unsubscribed" }]);
  });
});
