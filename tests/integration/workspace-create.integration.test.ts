import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
    const plan = await env.DB.prepare("SELECT count(*) AS n FROM plan").first<{ n: number }>();
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

  it("lands on /onboarding until a self entity exists", async () => {
    await seedUser("user-5", "maya@example.com");
    const input = {
      userId: "user-5",
      email: "maya@example.com",
      timezone: "UTC",
      now: "2026-09-22T12:00:00.000Z",
    };
    expect(await workspaceLanding(env.DB, input)).toBe("/onboarding");
    const workspaceId = firstWorkspaceId("user-5");
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, created_at)
       VALUES ('entity-5', ?, 'self', 'maya.example', '2026-09-22T12:01:00.000Z')`,
    )
      .bind(workspaceId)
      .run();
    expect(await workspaceLanding(env.DB, input)).toBeNull();
    expect(await workspaceCount("user-5")).toBe(1);
    const plans = await env.DB.prepare("SELECT count(*) AS n FROM plan WHERE workspace_id = ?")
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(plans?.n).toBe(0);
  });
});
