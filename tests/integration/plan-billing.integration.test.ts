import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readPlanCustomerId, readPlanSummary } from "../../app/lib/data/plan.server";
import { readWorkspaceIdForOwner } from "../../app/lib/data/workspace.server";

const STAMP = "2026-09-30T12:00:00.000Z";

async function seed(n: string, customerId: string | null): Promise<{ userId: string; workspaceId: string }> {
  const userId = `user-bill-${n}`;
  const workspaceId = `ws-bill-${n}`;
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(userId, userId, `${userId}@example.com`, STAMP, STAMP)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(workspaceId, n, userId, STAMP)
    .run();
  if (customerId !== null) {
    await env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, provider_customer_id, provider_subscription_id, current_period_end, updated_at)
       VALUES (?, ?, 'starter', 'active', ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
    )
      .bind(`plan-${n}`, workspaceId, customerId, `sub-${n}`, STAMP)
      .run();
  }
  return { userId, workspaceId };
}

describe("plan billing readers", () => {
  it("gives the owner's workspace its own customer id and no other workspace's", async () => {
    const mine = await seed("a", "cus_mine");
    const other = await seed("b", "cus_other");
    expect(await readPlanCustomerId(mine.workspaceId)).toBe("cus_mine");
    expect(await readPlanCustomerId(other.workspaceId)).toBe("cus_other");
    expect(await readWorkspaceIdForOwner(mine.userId)).toBe(mine.workspaceId);
  });

  it("has no customer id for a workspace that never paid, and says so in the summary", async () => {
    const free = await seed("c", null);
    expect(await readPlanCustomerId(free.workspaceId)).toBeNull();
    expect(await readPlanSummary(free.workspaceId)).toEqual({
      tier: "scout",
      status: "none",
      currentPeriodEnd: null,
      trialing: false,
      billed: false,
    });
  });

  it("reports a paying workspace as billed with its plan and renewal date", async () => {
    const paid = await seed("d", "cus_paid");
    expect(await readPlanSummary(paid.workspaceId)).toEqual({
      tier: "starter",
      status: "active",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      trialing: false,
      billed: true,
    });
  });

  it("finds no workspace for a user who does not own one", async () => {
    await env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
    )
      .bind("user-bill-visitor", "v", "user-bill-visitor@example.com", STAMP, STAMP)
      .run();
    expect(await readWorkspaceIdForOwner("user-bill-visitor")).toBeNull();
  });
});
