import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { readEntitlements, readWorkspaceEntitlements } from "../../app/lib/data/plan.server";

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
    expect(before.own_site_alerts).toBe(true);
    expect(before.marks_history_days).toBe(365);
    expect(before.standing_history_weeks).toBe(52);

    await env.DB.prepare("UPDATE plan SET limits_json = ? WHERE workspace_id = ?")
      .bind(JSON.stringify({ competitors: 7 }), workspaceId)
      .run();

    const after = await readEntitlements(workspaceId);
    expect(after.competitors).toBe(7);
    expect(after.site_pages_scope).toBe("all");
  });

  it("returns scout defaults, and logs nothing, for a workspace with no plan row", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-ent-none-${n}`;
    const workspaceId = `ws-ent-none-${n}`;
    await seedUser(userId, `ent-none-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Ent None");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const entitlements = await readEntitlements(workspaceId);
      expect(entitlements.competitors).toBe(5);
      expect(entitlements.site_pages_scope).toBe("home_pricing");
      expect(entitlements.own_site_alerts).toBe(false);
      expect(entitlements.marks_history_days).toBe(90);
      expect(entitlements.standing_history_weeks).toBe(4);
      expect(entitlements.workspaces_max).toBe(1);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("reads entitlements for more than 100 workspaces in one call, past D1's bound-parameter cap", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-ent-many-${n}`;
    await seedUser(userId, `ent-many-${n}@example.com`);
    const ids = Array.from({ length: 150 }, (_, index) => `ws-ent-many-${n}-${String(index)}`);
    await env.DB.batch(
      ids.map((id) =>
        env.DB.prepare(
          `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
           VALUES (?, 'Many', ?, 'UTC', 1, 8, '2026-09-23T12:00:00.000Z')`,
        ).bind(id, userId),
      ),
    );
    const paid = ids.at(-1) ?? "";
    await env.DB.prepare(
      "INSERT INTO plan (id, workspace_id, tier, limits_json, updated_at) VALUES (?, ?, 'starter', '{}', ?)",
    )
      .bind(`plan-ent-many-${n}`, paid, "2026-09-23T12:00:00.000Z")
      .run();

    const entitlements = await readWorkspaceEntitlements([...ids, ids[0] ?? ""]);

    expect(entitlements.size).toBe(150);
    expect(entitlements.get(paid)?.site_pages_scope).toBe("all");
    expect(entitlements.get(ids[0] ?? "")?.site_pages_scope).toBe("home_pricing");
  });

  it("reads entitlements across several id chunks and keeps a paid workspace from every chunk", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const ids = Array.from({ length: 1200 }, (_, index) => `ws-ent-chunk-${n}-${String(index)}`);
    const paid = [ids[0] ?? "", ids[700] ?? "", ids[1199] ?? ""];
    await env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
    )
      .bind(
        `user-ent-chunk-${n}`,
        "Chunk",
        `ent-chunk-${n}@example.com`,
        "2026-09-23T12:00:00.000Z",
        "2026-09-23T12:00:00.000Z",
      )
      .run();
    await env.DB.batch(
      paid.flatMap((id, index) => [
        env.DB.prepare(
          `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
           VALUES (?, 'Chunk', ?, 'UTC', 1, 8, '2026-09-23T12:00:00.000Z')`,
        ).bind(id, `user-ent-chunk-${n}`),
        env.DB.prepare(
          "INSERT INTO plan (id, workspace_id, tier, limits_json, updated_at) VALUES (?, ?, 'starter', '{}', ?)",
        ).bind(`plan-ent-chunk-${n}-${String(index)}`, id, "2026-09-23T12:00:00.000Z"),
      ]),
    );

    const entitlements = await readWorkspaceEntitlements(ids);

    expect(entitlements.size).toBe(1200);
    for (const id of paid) expect(entitlements.get(id)?.site_pages_scope).toBe("all");
    expect(entitlements.get(ids[1] ?? "")?.site_pages_scope).toBe("home_pricing");
  });
});
