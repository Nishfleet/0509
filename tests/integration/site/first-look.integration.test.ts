import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueFirstLook } from "../../../app/lib/site/first-look.server";

const NOW = "2026-10-13T12:00:00Z";
const WS = "ws-first-look";
const OTHER = "ws-first-look-other";
const sent = vi.hoisted(() => ({ bodies: [] as { entityId: string }[] }));

const seedWorkspace = async (id: string, userId: string, plan: "active" | "none") => {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, ?, ?)`,
  )
    .bind(userId, `${userId}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, 'W', ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, userId, NOW)
    .run();
  if (plan === "active") {
    await env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?, ?, 'starter', 'active', ?)`,
    )
      .bind(`plan-${id}`, id, NOW)
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at) VALUES (?, ?, 'competitor', ?, '{}', 'manual', 'on', ?)`,
  )
    .bind(`ent-${id}`, id, `${id}.com`, NOW)
    .run();
};

describe("first look at rivals", () => {
  beforeEach(async () => {
    sent.bodies.length = 0;
    for (const table of ["snapshot", "watch", "page", "entity", "plan", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    vi.spyOn(env.FETCH_SWEEP, "sendBatch").mockImplementation((messages) => {
      sent.bodies.push(...[...messages].map((message) => message.body as { entityId: string }));
      return Promise.resolve({ metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } });
    });
  });

  it("queues the paid workspace's rival right away and no one else's", async () => {
    await seedWorkspace(WS, "u-first-look", "active");
    await seedWorkspace(OTHER, "u-first-look-other", "active");
    expect(await enqueueFirstLook(WS, NOW)).toBe(1);
    expect(sent.bodies.map((body) => body.entityId)).toEqual([`ent-${WS}`]);
  });

  it("queues nothing for a workspace that has not paid", async () => {
    await seedWorkspace(WS, "u-first-look", "none");
    expect(await enqueueFirstLook(WS, NOW)).toBe(0);
    expect(sent.bodies).toEqual([]);
  });
});
