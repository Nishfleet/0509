import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readPlanSubscription, readPlanTier, readWorkspaceIdBySubscription } from "../../../app/lib/data/plan.server";

const NOW = "2026-09-24T00:00:00Z";

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(`user-${id}`, "Owner", `${id}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)`)
    .bind(id, "Owner", `user-${id}`, NOW)
    .run();
}

function insertPlan(id: string, workspaceId: string) {
  return env.DB.prepare(
    `INSERT INTO plan (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, trialing, updated_at)
     VALUES (?, ?, 'starter', 'active', 'cus-1', 'sub-1', '2026-10-01T00:00:00Z', 1, ?)`,
  ).bind(id, workspaceId, NOW);
}

beforeEach(async () => {
  for (const table of ["plan", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seedWorkspace("ws-a");
});

describe("readPlanTier", () => {
  it("returns the stored tier", async () => {
    await insertPlan("plan-a", "ws-a").run();
    expect(await readPlanTier("ws-a")).toBe("starter");
  });

  it("returns scout when no plan row exists", async () => {
    expect(await readPlanTier("ws-a")).toBe("scout");
  });
});

describe("readWorkspaceIdBySubscription", () => {
  it("returns the workspace id for a subscription id", async () => {
    await insertPlan("plan-a", "ws-a").run();
    expect(await readWorkspaceIdBySubscription("sub-1")).toBe("ws-a");
  });

  it("returns null for an unknown subscription id", async () => {
    expect(await readWorkspaceIdBySubscription("sub-none")).toBeNull();
  });
});

describe("readPlanSubscription", () => {
  it("maps the plan row into a subscription summary", async () => {
    await insertPlan("plan-a", "ws-a").run();
    expect(await readPlanSubscription("ws-a")).toEqual({
      tier: "starter",
      status: "active",
      currentPeriodEnd: "2026-10-01T00:00:00Z",
      subscriptionId: "sub-1",
      updatedAt: NOW,
    });
  });

  it("returns null when no plan row exists", async () => {
    expect(await readPlanSubscription("ws-a")).toBeNull();
  });
});
