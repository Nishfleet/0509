import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readEntitlements } from "../../app/lib/data/plan.server";

let seededRuns = 0;

async function seedUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, "2026-09-23T12:00:00.000Z", "2026-09-23T12:00:00.000Z")
    .run();
}

async function seedWorkspace(id: string, ownerUserId: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, name, ownerUserId, "2026-09-23T12:00:00.000Z")
    .run();
}

describe("readEntitlements (0509#5293)", () => {
  it("returns the plan row tier's limits, then the limits_json override after UPDATE", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-ent-${n}`;
    const workspaceId = `ws-ent-${n}`;
    await seedUser(userId, `ent-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Ent");
    await env.DB.prepare(
      "INSERT INTO plan (id, workspace_id, tier, limits_json, updated_at) VALUES (?, ?, 'starter', ?, ?)",
    )
      .bind(`plan-ent-${n}`, workspaceId, JSON.stringify({}), "2026-09-23T12:00:00.000Z")
      .run();

    const before = await readEntitlements(workspaceId);
    expect(before.competitors).toBe(15);
    expect(before.site_pages_scope).toBe("all");

    await env.DB.prepare("UPDATE plan SET limits_json = ? WHERE workspace_id = ?")
      .bind(JSON.stringify({ competitors: 7 }), workspaceId)
      .run();

    const after = await readEntitlements(workspaceId);
    expect(after.competitors).toBe(7);
    expect(after.site_pages_scope).toBe("all");
  });

  it("returns scout defaults for a workspace with no plan row", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-ent-none-${n}`;
    const workspaceId = `ws-ent-none-${n}`;
    await seedUser(userId, `ent-none-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Ent None");

    const entitlements = await readEntitlements(workspaceId);
    expect(entitlements.competitors).toBe(5);
    expect(entitlements.site_pages_scope).toBe("home_pricing");
  });
});
