import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleCompetitorIntent } from "../../app/lib/competitors.server";

/**
 * Manual-add cap (0509#4891): adding a competitor by hand is refused once the
 * workspace already has its plan's cap of ON competitors, with no row inserted
 * or switched on. The cap comes from the `plan` row's `limits_json.competitors`
 * when present, else the `PLANS` entry whose `id` equals the row's `tier`, else
 * the scout value (5).
 */

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

function intentForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

async function domainCount(workspaceId: string, domain: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT count(*) AS n FROM entity WHERE workspace_id = ? AND domain = ?",
  )
    .bind(workspaceId, domain)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function entityRow(
  workspaceId: string,
  domain: string,
): Promise<{ state: string; state_changed_by: string | null } | null> {
  return env.DB.prepare(
    "SELECT state, state_changed_by FROM entity WHERE workspace_id = ? AND domain = ?",
  )
    .bind(workspaceId, domain)
    .first<{ state: string; state_changed_by: string | null }>();
}

describe("addManualCompetitor cap (0509#4891)", () => {
  it("accepts the first five competitors then refuses the sixth with the cap message", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-cap-${n}`;
    const workspaceId = `ws-cap-${n}`;
    await seedUser(userId, `cap-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Cap");

    for (let i = 1; i <= 5; i += 1) {
      const result = await handleCompetitorIntent(
        workspaceId,
        intentForm({ intent: "add", competitor: `a${String(i)}.com` }),
      );
      expect(result.message).toBeNull();
    }
    const sixth = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "add", competitor: "a6.com" }),
    );
    expect(sixth.message).not.toBeNull();
    expect(sixth.message).toContain("5 competitors");
    expect(await domainCount(workspaceId, "a6.com")).toBe(0);
  });

  it("still adds a competitor that is already ON at cap (silent no-op)", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-cap-resame-${n}`;
    const workspaceId = `ws-cap-resame-${n}`;
    await seedUser(userId, `cap-resame-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Cap Resame");

    for (let i = 1; i <= 5; i += 1) {
      const result = await handleCompetitorIntent(
        workspaceId,
        intentForm({ intent: "add", competitor: `a${String(i)}.com` }),
      );
      expect(result.message).toBeNull();
    }
    const reAdd = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "add", competitor: "a1.com" }),
    );
    expect(reAdd.message).toBeNull();
    const row = await entityRow(workspaceId, "a1.com");
    expect(row?.state).toBe("on");
  });

  it("refuses a re-add that would switch an OFF row back on when the workspace is at cap", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-cap-reoff-${n}`;
    const workspaceId = `ws-cap-reoff-${n}`;
    await seedUser(userId, `cap-reoff-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Cap Reoff");

    for (let i = 1; i <= 5; i += 1) {
      await handleCompetitorIntent(
        workspaceId,
        intentForm({ intent: "add", competitor: `a${String(i)}.com` }),
      );
    }
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, state_changed_at, state_changed_by, created_at)
       VALUES (?, ?, 'competitor', 'off-one.com', 'Off One', 'manual', 'off', ?, 'user', ?)`,
    )
      .bind(
        `off-entity-${n}`,
        workspaceId,
        "2026-09-23T12:00:00.000Z",
        "2026-09-23T12:00:00.000Z",
      )
      .run();

    const result = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "add", competitor: "off-one.com" }),
    );
    expect(result.message).not.toBeNull();
    expect(result.message).toContain("5 competitors");
    const row = await entityRow(workspaceId, "off-one.com");
    expect(row?.state).toBe("off");
  });

  it("uses the plan row's limits_json.competitors when present", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-cap-plan-${n}`;
    const workspaceId = `ws-cap-plan-${n}`;
    await seedUser(userId, `cap-plan-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Cap Plan");
    await env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, updated_at, limits_json)
       VALUES (?, ?, 'scout', ?, ?)`,
    )
      .bind(
        `plan-${n}`,
        workspaceId,
        "2026-09-23T12:00:00.000Z",
        JSON.stringify({ competitors: 2 }),
      )
      .run();

    const first = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "add", competitor: "b1.com" }),
    );
    expect(first.message).toBeNull();
    const second = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "add", competitor: "b2.com" }),
    );
    expect(second.message).toBeNull();
    const third = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "add", competitor: "b3.com" }),
    );
    expect(third.message).not.toBeNull();
    expect(third.message).toContain("2 competitors");
    expect(await domainCount(workspaceId, "b3.com")).toBe(0);
  });
});