import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { planSiteSweep } from "../../app/lib/site/sweep.server";
import { loadNightlyPlan } from "../../workers/standing/rollover-plan";
import { deliver } from "../../workers/delivery/consumer";

const NOW = "2026-10-05T12:00:00.000Z";

async function seedUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, NOW, NOW)
    .run();
}

async function seedWorkspace(id: string, ownerUserId: string, paid: boolean): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at, fixture)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?, 0)`,
  )
    .bind(id, id, ownerUserId, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, state, domain, name, identity_json, created_at)
     VALUES (?, ?, 'self', 'on', ?, 'Self', '{}', ?)`,
  )
    .bind(`${id}-self`, id, `${id}.example.com`, NOW)
    .run();
  if (!paid) return;
  await env.DB.prepare(
    "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?, ?, 'scout', 'trialing', ?)",
  )
    .bind(`${id}-plan`, id, NOW)
    .run();
}

describe("unpaid workspaces (0509#7061)", () => {
  it("gives a workspace with no plan row no sweep, brief or alert", async () => {
    await seedUser("user-unpaid-7061", "unpaid-7061@example.com");
    await seedWorkspace("ws-unpaid-7061", "user-unpaid-7061", false);
    await seedUser("user-paid-7061", "paid-7061@example.com");
    await seedWorkspace("ws-paid-7061", "user-paid-7061", true);

    const targets = await planSiteSweep(NOW);
    expect(targets.some((target) => target.workspaceId === "ws-unpaid-7061")).toBe(false);

    const nightly = await loadNightlyPlan(env.DB, new Date(NOW));
    expect(nightly.scheduled.map((instance) => instance.params.workspaceId)).not.toContain("ws-unpaid-7061");

    await env.DB.prepare(
      `INSERT INTO digest (id, workspace_id, kind, status, period_start, period_end, subject, payload_json)
       VALUES ('digest-unpaid-7061', 'ws-unpaid-7061', 'weekly', 'pending', ?, ?, 'Brief', '{}')`,
    )
      .bind(NOW, NOW)
      .run();
    const sent = await deliver(env, { digest_id: "digest-unpaid-7061" });
    expect(sent.outcome).toBe("suppressed");
  });
});
