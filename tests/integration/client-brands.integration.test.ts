import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  BRAND_FULL,
  BRAND_NAME_INVALID,
  BRAND_NEEDS_AGENCY,
  addClientBrand,
  readBrandPanel,
  readOtherBrands,
  switchClientBrand,
} from "../../app/lib/client-brands.server";
import { loadNightlyPlan } from "../../workers/standing/rollover-plan";
import { MAX_CLIENT_BRANDS } from "../../app/lib/client-brands";
import { readWorkspaceExport } from "../../app/lib/data-export.server";
import { readEntitlements, readPlanSubscription } from "../../app/lib/data/plan.server";
import {
  readBriefSchedulesForOwner,
  readBillingWorkspaceId,
  readWorkspaceIdForOwner,
} from "../../app/lib/data/workspace.server";

const FUTURE = "2099-01-01T00:00:00Z";

const AGENCY = { id: "agency-owner", email: "agency-owner@example.test" };
const SOLO = { id: "solo-owner", email: "solo-owner@example.test" };

async function seedOwner(user: { id: string; email: string }, workspaceId: string, tier: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?1, 'U', ?2, 1, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
    ).bind(user.id, user.email),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at)
       VALUES (?1, 'Home', ?2, 'Asia/Kolkata', '2026-10-01T00:00:00Z')`,
    ).bind(workspaceId, user.id),
    env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, current_period_end, updated_at)
       VALUES (?1, ?2, ?3, 'active', ?4, '2026-10-01T00:00:00Z')`,
    ).bind(`plan-${workspaceId}`, workspaceId, tier, FUTURE),
  ]);
}

describe("client brands", () => {
  beforeEach(async () => {
    for (const table of ["send_target", "active_workspace", "plan", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await seedOwner(AGENCY, "ws-agency", "agency");
    await seedOwner(SOLO, "ws-solo", "starter");
  });

  it("adds a client brand under the Agency workspace and opens it", async () => {
    expect(await addClientBrand(AGENCY, "Acme Foods")).toEqual({ status: "added" });
    const activeId = await readWorkspaceIdForOwner(AGENCY.id);
    expect(activeId).not.toBe("ws-agency");
    const row = await env.DB.prepare("SELECT name, parent_workspace_id, timezone FROM workspace WHERE id = ?")
      .bind(activeId)
      .first();
    expect(row).toEqual({ name: "Acme Foods", parent_workspace_id: "ws-agency", timezone: "Asia/Kolkata" });
    expect((await readEntitlements(activeId ?? "")).competitors).toBe(50);
  });

  it("points a second client at the Agency workspace, not at the first client", async () => {
    await addClientBrand(AGENCY, "One");
    await addClientBrand(AGENCY, "Two");
    const second = await readWorkspaceIdForOwner(AGENCY.id);
    expect(await readBillingWorkspaceId(second ?? "")).toBe("ws-agency");
  });

  it("nests a new brand under the Agency workspace even when the open client has its own plan row", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    const clientId = await readWorkspaceIdForOwner(AGENCY.id);
    await env.DB.prepare(
      `INSERT INTO plan (id, workspace_id, tier, status, current_period_end, updated_at)
       VALUES ('plan-client', ?1, 'starter', 'active', ?2, '2026-10-01T00:00:00Z')`,
    )
      .bind(clientId, FUTURE)
      .run();
    expect(await addClientBrand(AGENCY, "Beta Bikes")).toEqual({ status: "added" });
    const row = await env.DB.prepare("SELECT parent_workspace_id FROM workspace WHERE id = ?")
      .bind(await readWorkspaceIdForOwner(AGENCY.id))
      .first();
    expect(row).toEqual({ parent_workspace_id: "ws-agency" });
  });

  it("schedules the weekly rollover for a client brand through its Agency parent", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    const clientId = await readWorkspaceIdForOwner(AGENCY.id);
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, created_at)
       VALUES ('ent-client', ?1, 'self', 'acme.example.test', '2026-10-01T00:00:00Z')`,
    )
      .bind(clientId)
      .run();
    const plan = await loadNightlyPlan(env.DB, new Date());
    expect(plan.scheduled.map((instance) => instance.params.workspaceId)).toContain(clientId);
  });

  it("gives the client brand an owner email target for its brief", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    const activeId = await readWorkspaceIdForOwner(AGENCY.id);
    const target = await env.DB.prepare("SELECT target_value FROM send_target WHERE workspace_id = ?")
      .bind(activeId)
      .first();
    expect(target).toEqual({ target_value: AGENCY.email });
  });

  it("refuses a client brand on a plan without workspaces", async () => {
    expect(await addClientBrand(SOLO, "Acme Foods")).toEqual({ status: "refused", message: BRAND_NEEDS_AGENCY });
    expect(await readWorkspaceIdForOwner(SOLO.id)).toBe("ws-solo");
  });

  it("refuses an empty or very long name", async () => {
    expect(await addClientBrand(AGENCY, "   ")).toEqual({ status: "refused", message: BRAND_NAME_INVALID });
    expect(await addClientBrand(AGENCY, "x".repeat(61))).toEqual({ status: "refused", message: BRAND_NAME_INVALID });
  });

  it("switches only between the owner's own workspaces", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    expect(await switchClientBrand(AGENCY.id, "ws-agency")).toBe(true);
    expect(await readWorkspaceIdForOwner(AGENCY.id)).toBe("ws-agency");
    expect(await switchClientBrand(AGENCY.id, "ws-solo")).toBe(false);
    expect(await readWorkspaceIdForOwner(AGENCY.id)).toBe("ws-agency");
  });

  it("lists brands, marks the open one, and only offers adding where the plan allows", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    const panel = await readBrandPanel(AGENCY.id);
    expect(panel.canAdd).toBe(true);
    expect(panel.brands.map((brand) => [brand.name, brand.current])).toEqual([
      ["Home", false],
      ["Acme Foods", true],
    ]);
    expect((await readOtherBrands(AGENCY.id)).map((brand) => brand.name)).toEqual(["Home"]);
    expect((await readBrandPanel(SOLO.id)).canAdd).toBe(false);
  });

  it("lists every owned workspace for account deletion", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    expect((await readBriefSchedulesForOwner(AGENCY.id)).length).toBe(2);
    expect((await readBriefSchedulesForOwner(SOLO.id)).length).toBe(1);
  });

  it("stops at the fair use limit and says so", async () => {
    const stamp = "2026-10-02T00:00:00Z";
    await env.DB.batch(
      Array.from({ length: MAX_CLIENT_BRANDS }, (_, index) =>
        env.DB.prepare(
          `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at, parent_workspace_id)
           VALUES (?1, 'Client', ?2, 'UTC', ?3, 'ws-agency')`,
        ).bind(`ws-client-${String(index)}`, AGENCY.id, stamp),
      ),
    );
    expect(await addClientBrand(AGENCY, "One too many")).toEqual({ status: "refused", message: BRAND_FULL });
    const panel = await readBrandPanel(AGENCY.id);
    expect(panel.canAdd).toBe(false);
    expect(panel.full).toBe(true);
    expect(MAX_CLIENT_BRANDS).toBe(25);
  });

  it("exports every brand the owner has, not only the open one", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    const open = await readWorkspaceIdForOwner(AGENCY.id);
    const others = (await readOtherBrands(AGENCY.id)).map((brand) => brand.id);
    const data = await readWorkspaceExport({
      workspaceId: open ?? "",
      otherWorkspaceIds: others,
      userId: AGENCY.id,
      email: AGENCY.email,
      now: new Date(),
    });
    expect(data?.workspace).toMatchObject({ name: "Acme Foods" });
    expect(data?.otherBrands?.map((brand) => brand.workspace)).toEqual([expect.objectContaining({ name: "Home" })]);
  });

  it("never lets two requests at once pass the limit", async () => {
    await env.DB.batch(
      Array.from({ length: MAX_CLIENT_BRANDS - 1 }, (_, index) =>
        env.DB.prepare(
          `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at, parent_workspace_id)
           VALUES (?1, 'Client', ?2, 'UTC', '2026-10-02T00:00:00Z', 'ws-agency')`,
        ).bind(`ws-race-${String(index)}`, AGENCY.id),
      ),
    );
    const outcomes = await Promise.all([addClientBrand(AGENCY, "First"), addClientBrand(AGENCY, "Second")]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["added", "refused"]);
    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM workspace WHERE parent_workspace_id = 'ws-agency'",
    ).first();
    expect(count).toEqual({ n: MAX_CLIENT_BRANDS });
  });

  it("falls back to the first brand and refuses to open clients once the owner leaves Agency", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    await env.DB.exec("UPDATE plan SET tier = 'starter' WHERE workspace_id = 'ws-agency'");
    expect(await readWorkspaceIdForOwner(AGENCY.id)).toBe("ws-agency");
    const panel = await readBrandPanel(AGENCY.id);
    expect(panel.brands.map((brand) => [brand.name, brand.paused])).toEqual([
      ["Home", false],
      ["Acme Foods", true],
    ]);
    const client = panel.brands.find((brand) => brand.paused);
    expect(await switchClientBrand(AGENCY.id, client?.id ?? "")).toBe(false);
    expect(await readOtherBrands(AGENCY.id)).toEqual([]);
  });

  it("keeps the subscription on the Agency workspace only, so deleting the account cancels it once", async () => {
    await addClientBrand(AGENCY, "Acme Foods");
    const activeId = await readWorkspaceIdForOwner(AGENCY.id);
    expect(await readPlanSubscription(activeId ?? "")).toBeNull();
    expect(await readPlanSubscription("ws-agency")).not.toBeNull();
  });
});
