import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readEntitlements, readPaidWorkspaceIds } from "../../app/lib/data/plan.server";
import { readWorkspaceIdForOwner, readWorkspaceLanding } from "../../app/lib/data/workspace.server";

const FUTURE = "2099-01-01T00:00:00Z";
const PAST = "2020-01-01T00:00:00Z";

async function seedPlan(workspaceId: string, tier: string, status: string, periodEnd: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO plan (id, workspace_id, tier, status, current_period_end, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, '2026-10-01T00:00:00Z')",
  )
    .bind(`plan-${workspaceId}`, workspaceId, tier, status, periodEnd)
    .run();
}

describe("Agency client workspaces", () => {
  beforeEach(async () => {
    for (const table of ["active_workspace", "plan", "workspace"]) await env.DB.exec(`DELETE FROM ${table}`);
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.batch([
      ...["agency-owner", "other-owner"].map((id) =>
        env.DB.prepare(
          `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
           VALUES (?1, 'U', ?1 || '@example.test', 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
        ).bind(id),
      ),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at)
         VALUES ('ws-agency', 'Agency', 'agency-owner', 'UTC', '2026-10-01T00:00:00Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at, parent_workspace_id)
         VALUES ('ws-client', 'Client', 'agency-owner', 'UTC', '2026-10-02T00:00:00Z', 'ws-agency')`,
      ),
      env.DB.prepare(
        `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at)
         VALUES ('ws-other', 'Other', 'other-owner', 'UTC', '2026-10-01T00:00:00Z')`,
      ),
    ]);
  });

  it("opens the oldest workspace until one is chosen", async () => {
    expect(await readWorkspaceIdForOwner("agency-owner")).toBe("ws-agency");
  });

  it("opens the chosen workspace", async () => {
    await seedPlan("ws-agency", "agency", "active", FUTURE);
    await env.DB.exec("INSERT INTO active_workspace (user_id, workspace_id) VALUES ('agency-owner', 'ws-client')");
    expect(await readWorkspaceIdForOwner("agency-owner")).toBe("ws-client");
    expect((await readWorkspaceLanding(env.DB, "agency-owner"))?.id).toBe("ws-client");
  });

  it("ignores a choice that points at someone else's workspace", async () => {
    await env.DB.exec("INSERT INTO active_workspace (user_id, workspace_id) VALUES ('agency-owner', 'ws-other')");
    expect(await readWorkspaceIdForOwner("agency-owner")).toBe("ws-agency");
    expect(await readWorkspaceIdForOwner("other-owner")).toBe("ws-other");
  });

  it("gives a client the entitlements and paid state of its Agency workspace", async () => {
    await seedPlan("ws-agency", "agency", "active", FUTURE);
    expect((await readEntitlements("ws-client")).competitors).toBe(50);
    const paid = await readPaidWorkspaceIds(new Date());
    expect(paid.has("ws-client")).toBe(true);
    expect(paid.has("ws-other")).toBe(false);
    expect((await readWorkspaceLanding(env.DB, "agency-owner"))?.plan_status).toBe("active");
  });

  it("pauses a client with its lapsed Agency workspace", async () => {
    await seedPlan("ws-agency", "agency", "cancelled", PAST);
    expect((await readEntitlements("ws-client")).competitors).toBe(5);
    const paid = await readPaidWorkspaceIds(new Date());
    expect(paid.has("ws-client")).toBe(false);
    expect(paid.has("ws-agency")).toBe(false);
  });

  it("uses a workspace's own plan row when it has one", async () => {
    await seedPlan("ws-agency", "agency", "active", FUTURE);
    await seedPlan("ws-client", "scout", "active", FUTURE);
    expect((await readEntitlements("ws-client")).competitors).toBe(5);
  });

  it("never lends a plan to another owner's workspace", async () => {
    await seedPlan("ws-agency", "agency", "active", FUTURE);
    expect((await readEntitlements("ws-other")).competitors).toBe(5);
  });

  it("ignores a parent that belongs to a different owner", async () => {
    await seedPlan("ws-agency", "agency", "active", FUTURE);
    await env.DB.exec("UPDATE workspace SET parent_workspace_id = 'ws-agency' WHERE id = 'ws-other'");
    expect((await readEntitlements("ws-other")).competitors).toBe(5);
    expect((await readPaidWorkspaceIds(new Date())).has("ws-other")).toBe(false);
  });

  it("stops lending the plan once the parent is no longer on a plan with client brands", async () => {
    await seedPlan("ws-agency", "starter", "active", FUTURE);
    expect((await readEntitlements("ws-client")).competitors).toBe(5);
    const paid = await readPaidWorkspaceIds(new Date());
    expect(paid.has("ws-agency")).toBe(true);
    expect(paid.has("ws-client")).toBe(false);
  });
});
