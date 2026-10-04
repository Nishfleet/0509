import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleCompetitorIntent } from "../../app/lib/competitors.server";

/**
 * Manual-add cap (0509#4891): adding a competitor by hand is refused once the
 * workspace already has its plan's cap of ON competitors, with no row inserted
 * or switched on. The cap comes from the `plan` row's `limits_json.competitors`
 * when present, else the `PLANS` entry whose `id` equals the row's `tier`, else
 * the scout value (5).
 */

let seededRuns = 0;

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("not found", { status: 404 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  const row = await env.DB.prepare("SELECT count(*) AS n FROM entity WHERE workspace_id = ? AND domain = ?")
    .bind(workspaceId, domain)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function entityRow(
  workspaceId: string,
  domain: string,
): Promise<{ state: string; state_changed_by: string | null } | null> {
  return env.DB.prepare("SELECT state, state_changed_by FROM entity WHERE workspace_id = ? AND domain = ?")
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
    const sixth = await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: "a6.com" }));
    expect(sixth.message).not.toBeNull();
    expect(sixth.message).toContain("5 competitors");
    expect(sixth.upgradePlanId).toBe("starter");
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
    const reAdd = await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: "a1.com" }));
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
      await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: `a${String(i)}.com` }));
    }
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, state_changed_at, state_changed_by, created_at)
       VALUES (?, ?, 'competitor', 'off-one.com', 'Off One', 'manual', 'off', ?, 'user', ?)`,
    )
      .bind(`off-entity-${n}`, workspaceId, "2026-09-23T12:00:00.000Z", "2026-09-23T12:00:00.000Z")
      .run();

    const result = await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: "off-one.com" }));
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
      .bind(`plan-${n}`, workspaceId, "2026-09-23T12:00:00.000Z", JSON.stringify({ competitors: 2 }))
      .run();

    const first = await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: "b1.com" }));
    expect(first.message).toBeNull();
    const second = await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: "b2.com" }));
    expect(second.message).toBeNull();
    const third = await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: "b3.com" }));
    expect(third.message).not.toBeNull();
    expect(third.message).toContain("2 competitors");
    expect(await domainCount(workspaceId, "b3.com")).toBe(0);
  });

  it("stores identity_json.url for subdomain entries and updates on re-add", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-identity-${n}`;
    const workspaceId = `ws-identity-${n}`;
    await seedUser(userId, `identity-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Identity");

    const fixtureResult = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "add", competitor: "fixture.0509.in" }),
    );
    expect(fixtureResult.message).toBeNull();
    const fixtureRow = await env.DB.prepare(
      "SELECT domain, identity_json FROM entity WHERE workspace_id = ? AND domain = ?",
    )
      .bind(workspaceId, "0509.in")
      .first<{ domain: string; identity_json: string }>();
    expect(fixtureRow).not.toBeNull();
    expect(fixtureRow?.domain).toBe("0509.in");
    expect(JSON.parse(fixtureRow?.identity_json ?? "{}").url).toBe("https://fixture.0509.in/");

    const nikeResult = await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: "nike.com" }));
    expect(nikeResult.message).toBeNull();
    const nikeRow = await env.DB.prepare(
      "SELECT domain, identity_json FROM entity WHERE workspace_id = ? AND domain = ?",
    )
      .bind(workspaceId, "nike.com")
      .first<{ domain: string; identity_json: string }>();
    expect(nikeRow).not.toBeNull();
    expect(JSON.parse(nikeRow?.identity_json ?? "{}").url).toBe("https://nike.com/");

    await env.DB.prepare(
      "UPDATE entity SET state = 'off', state_changed_at = ?, state_changed_by = 'user' WHERE workspace_id = ? AND domain = ?",
    )
      .bind("2026-09-23T13:00:00.000Z", workspaceId, "nike.com")
      .run();

    const reAddResult = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "add", competitor: "www.nike.com" }),
    );
    expect(reAddResult.message).toBeNull();
    const reAddRow = await env.DB.prepare(
      "SELECT domain, identity_json FROM entity WHERE workspace_id = ? AND domain = ?",
    )
      .bind(workspaceId, "nike.com")
      .first<{ domain: string; identity_json: string }>();
    expect(reAddRow).not.toBeNull();
    expect(JSON.parse(reAddRow?.identity_json ?? "{}").url).toBe("https://www.nike.com/");
    expect(await domainCount(workspaceId, "nike.com")).toBe(1);
  });
});

async function seedAtCap(label: string, tier?: { tier: "starter"; status: "active" }): Promise<string> {
  seededRuns += 1;
  const n = String(seededRuns);
  const userId = `user-${label}-${n}`;
  const workspaceId = `ws-${label}-${n}`;
  await seedUser(userId, `${label}-${n}@example.com`);
  await seedWorkspace(workspaceId, userId, label);
  if (tier !== undefined) {
    await env.DB.prepare(
      "INSERT INTO plan (id, workspace_id, tier, status, updated_at) VALUES (?, ?, ?, ?, '2026-09-23T12:00:00.000Z')",
    )
      .bind(`plan-${label}-${n}`, workspaceId, tier.tier, tier.status)
      .run();
  }
  return workspaceId;
}

async function seedOffRival(workspaceId: string, domain: string): Promise<string> {
  const entityId = `off-${domain}-${workspaceId}`;
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, state_changed_at, state_changed_by, created_at)
     VALUES (?, ?, 'competitor', ?, ?, 'manual', 'off', ?, 'user', ?)`,
  )
    .bind(entityId, workspaceId, domain, domain, "2026-09-23T12:00:00.000Z", "2026-09-23T12:00:00.000Z")
    .run();
  return entityId;
}

describe("the cap on every path that turns a rival on", () => {
  it("refuses to switch a rival back on at the cap, with the cap message", async () => {
    const workspaceId = await seedAtCap("switch-on");
    for (let i = 1; i <= 5; i += 1) {
      await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: `s${String(i)}.com` }));
    }
    const entityId = await seedOffRival(workspaceId, "waiting.com");

    const result = await handleCompetitorIntent(workspaceId, intentForm({ intent: "on", entityId }));

    expect(result.message).toContain("5 competitors");
    expect(result.upgradePlanId).toBe("starter");
    expect((await entityRow(workspaceId, "waiting.com"))?.state).toBe("off");
  });

  it("switches a rival on when there is room, and switching off always works", async () => {
    const workspaceId = await seedAtCap("switch-room");
    const entityId = await seedOffRival(workspaceId, "roomy.com");

    const on = await handleCompetitorIntent(workspaceId, intentForm({ intent: "on", entityId }));
    expect(on.message).toBeNull();
    expect((await entityRow(workspaceId, "roomy.com"))?.state).toBe("on");

    const off = await handleCompetitorIntent(workspaceId, intentForm({ intent: "off", entityId }));
    expect(off.message).toBeNull();
    expect((await entityRow(workspaceId, "roomy.com"))?.state).toBe("off");
  });

  it("gives a paid plan its higher cap: a sixth rival is added on starter", async () => {
    const workspaceId = await seedAtCap("paid-cap", { tier: "starter", status: "active" });
    for (let i = 1; i <= 6; i += 1) {
      const result = await handleCompetitorIntent(
        workspaceId,
        intentForm({ intent: "add", competitor: `p${String(i)}.com` }),
      );
      expect(result.message).toBeNull();
    }
    expect(await domainCount(workspaceId, "p6.com")).toBe(1);
    const off = await seedOffRival(workspaceId, "paid-off.com");
    const result = await handleCompetitorIntent(workspaceId, intentForm({ intent: "on", entityId: off }));
    expect(result.message).toBeNull();
  });

  it("returns the cap message when accepting a suggestion at the cap", async () => {
    const workspaceId = await seedAtCap("accept-cap");
    for (let i = 1; i <= 5; i += 1) {
      await handleCompetitorIntent(workspaceId, intentForm({ intent: "add", competitor: `c${String(i)}.com` }));
    }
    await env.DB.prepare(
      `INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, candidate_name, verdict_p, status, created_at)
       VALUES (?, ?, 'add', 'maybe.com', 'Maybe', 0.7, 'pending', '2026-09-23T12:00:00.000Z')`,
    )
      .bind(`sugg-${workspaceId}`, workspaceId)
      .run();

    const result = await handleCompetitorIntent(
      workspaceId,
      intentForm({ intent: "accept", suggestionId: `sugg-${workspaceId}` }),
    );

    expect(result.message).toContain("5 competitors");
    expect(result.upgradePlanId).toBe("starter");
    expect(await domainCount(workspaceId, "maybe.com")).toBe(0);
  });
});
