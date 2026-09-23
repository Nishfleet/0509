import { env } from "cloudflare:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { OnCompetitorList } from "../../app/components/onboarding/competitor-lists";
import {
  addUserCompetitor,
  listOnCompetitors,
} from "../../app/lib/data/entity.server";
import { markCompetitorsReady } from "../../app/lib/data/onboarding-run.server";
import { acceptSuggestion, listMaybeCompetitors } from "../../app/lib/data/suggestion.server";
import { domainFromInput } from "../../app/routes/onboarding.competitors";

// Issue #3999's write and read paths against real workerd D1 with
// migrations/0001_rebuild.sql applied. The screen only renders these rows, so
// what is asserted here is the whole contract: ON list, maybe list, the manual
// add that skips judgment, and the flip that turns a maybe into an ON entity.

const USER_ID = "user-1";
const WORKSPACE_ID = "ws-1";
const NOW = "2026-09-23T08:00:00.000Z";

async function seedWorkspace(workspaceId = WORKSPACE_ID, userId = USER_ID): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(userId, "Ada", `${userId}@example.com`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(workspaceId, "ada", userId, NOW)
    .run();
}

async function seedSuggestion(
  overrides: Partial<{
    id: string;
    workspaceId: string;
    entityId: string | null;
    domain: string;
    name: string | null;
    kind: string;
    p: number | null;
    reason: string | null;
    status: string;
  }> = {},
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO suggestion
       (id, workspace_id, entity_id, kind, candidate_domain, candidate_name, verdict_p, verdict_reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      overrides.workspaceId ?? WORKSPACE_ID,
      overrides.entityId ?? null,
      overrides.kind ?? "add",
      overrides.domain ?? "alphaleteathletics.com",
      overrides.name ?? "Alphalete",
      overrides.p === undefined ? 0.42 : overrides.p,
      overrides.reason === undefined ? "sells to the same audience" : overrides.reason,
      overrides.status ?? "pending",
      NOW,
    )
    .run();
  return id;
}

async function entityRow(domain: string, workspaceId = WORKSPACE_ID) {
  return env.DB.prepare(
    "SELECT id, role, state, origin, state_reason, state_changed_by FROM entity WHERE workspace_id = ? AND domain = ?",
  )
    .bind(workspaceId, domain)
    .first<{
      id: string;
      role: string;
      state: string;
      origin: string;
      state_reason: string | null;
      state_changed_by: string | null;
    }>();
}

async function suggestionRow(id: string) {
  return env.DB.prepare("SELECT status, decided_by, entity_id FROM suggestion WHERE id = ?")
    .bind(id)
    .first<{ status: string; decided_by: string | null; entity_id: string | null }>();
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM suggestion").run();
  await env.DB.prepare("DELETE FROM entity").run();
  await env.DB.prepare("DELETE FROM onboarding_run").run();
  await env.DB.prepare("DELETE FROM workspace").run();
  await env.DB.prepare('DELETE FROM "user"').run();
  await seedWorkspace();
});

describe("listOnCompetitors / listMaybeCompetitors", () => {
  it("splits the entity ON rows from the pending maybes, each with its reason", async () => {
    await addUserCompetitor(WORKSPACE_ID, { domain: "gymshark.com", name: null, now: NOW });
    await seedSuggestion({ domain: "alphaleteathletics.com", p: 0.42 });
    await seedSuggestion({ domain: "dropped.example", status: "dismissed" });

    const on = await listOnCompetitors(WORKSPACE_ID);
    expect(on).toEqual([
      { id: expect.any(String), domain: "gymshark.com", name: "gymshark.com", reason: "added by you" },
    ]);

    const maybes = await listMaybeCompetitors(WORKSPACE_ID);
    expect(maybes).toEqual([
      {
        id: expect.any(String),
        domain: "alphaleteathletics.com",
        name: "Alphalete",
        reason: "sells to the same audience",
        p: 0.42,
      },
    ]);
  });

  it("reads the ON reason from the accepted suggestion's verdict", async () => {
    const suggestionId = await seedSuggestion({
      domain: "vuori.com",
      name: "Vuori",
      reason: "same DTC activewear buyer",
    });
    await acceptSuggestion(WORKSPACE_ID, suggestionId);

    const on = await listOnCompetitors(WORKSPACE_ID);
    expect(on).toHaveLength(1);
    expect(on[0]?.name).toBe("Vuori");
    expect(on[0]?.reason).toBe("same DTC activewear buyer");
  });

  it("lists one ON row per entity when several accepted suggestions point at it", async () => {
    const entityId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, created_at)
       VALUES (?, ?, 'competitor', 'gymshark.com', 'Gymshark', 'auto', 'on', ?)`,
    )
      .bind(entityId, WORKSPACE_ID, NOW)
      .run();
    const first = await seedSuggestion({ domain: "gymshark.com", entityId, status: "accepted", reason: "first verdict" });
    const second = await seedSuggestion({ domain: "gymshark.net", entityId, status: "accepted", reason: "second verdict" });
    await env.DB.prepare("UPDATE suggestion SET decided_at = ? WHERE id = ?").bind("2026-09-23T08:01:00.000Z", first).run();
    await env.DB.prepare("UPDATE suggestion SET decided_at = ? WHERE id = ?").bind("2026-09-23T08:02:00.000Z", second).run();

    const on = await listOnCompetitors(WORKSPACE_ID);
    expect(on).toHaveLength(1);
    expect(on[0]?.id).toBe(entityId);
    expect(on[0]?.reason).toBe("second verdict");
  });
});

describe("addUserCompetitor", () => {
  it("writes a manual competitor entity that is on, and accepts a matching pending suggestion", async () => {
    const suggestionId = await seedSuggestion({ domain: "gymshark.com", status: "pending" });
    const entityId = await addUserCompetitor(WORKSPACE_ID, { domain: "gymshark.com", name: null, now: NOW });

    const entity = await entityRow("gymshark.com");
    expect(entity).toMatchObject({
      id: entityId,
      role: "competitor",
      state: "on",
      origin: "manual",
      state_reason: "added by you",
      state_changed_by: "user",
    });

    const suggestion = await suggestionRow(suggestionId);
    expect(suggestion).toMatchObject({ status: "accepted", decided_by: "user", entity_id: entityId });
  });

  it("leaves a dismissed suggestion for the same domain dismissed", async () => {
    const dismissed = await seedSuggestion({ domain: "gymshark.com", status: "dismissed" });
    await addUserCompetitor(WORKSPACE_ID, { domain: "gymshark.com", name: null, now: NOW });

    expect(await entityRow("gymshark.com")).toMatchObject({ state: "on", origin: "manual" });
    expect((await suggestionRow(dismissed))?.status).toBe("dismissed");
  });

  it("leaves a pending retire suggestion for the same domain pending", async () => {
    const retire = await seedSuggestion({ domain: "gymshark.com", kind: "retire", status: "pending" });
    await addUserCompetitor(WORKSPACE_ID, { domain: "gymshark.com", name: null, now: NOW });

    expect(await entityRow("gymshark.com")).toMatchObject({ state: "on", origin: "manual" });
    expect((await suggestionRow(retire))?.status).toBe("pending");
  });

  it("is idempotent for the same domain and re-on's a dismissed entity", async () => {
    await addUserCompetitor(WORKSPACE_ID, { domain: "gymshark.com", name: null, now: NOW });
    await env.DB.prepare("UPDATE entity SET state = 'dismissed' WHERE domain = 'gymshark.com'").run();
    const again = await addUserCompetitor(WORKSPACE_ID, { domain: "gymshark.com", name: null, now: NOW });

    const entity = await entityRow("gymshark.com");
    expect(entity?.state).toBe("on");
    expect(entity?.id).toBe(again);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM entity WHERE domain = 'gymshark.com'").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

describe("acceptSuggestion", () => {
  it("creates the entity from the candidate and marks the suggestion accepted", async () => {
    const suggestionId = await seedSuggestion({ domain: "oneractive.com", name: "Oner Active" });
    expect(await acceptSuggestion(WORKSPACE_ID, suggestionId)).toBe(true);

    const entity = await entityRow("oneractive.com");
    expect(entity).toMatchObject({ role: "competitor", state: "on", origin: "auto" });
    expect(await suggestionRow(suggestionId)).toMatchObject({
      status: "accepted",
      decided_by: "user",
      entity_id: entity?.id,
    });
  });

  it("turns the linked entity on instead of inserting a second row", async () => {
    const entityId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, created_at)
       VALUES (?, ?, 'competitor', 'gymshark.com', 'Gymshark', 'auto', 'off', ?)`,
    )
      .bind(entityId, WORKSPACE_ID, NOW)
      .run();
    const suggestionId = await seedSuggestion({ domain: "gymshark.com", entityId });

    expect(await acceptSuggestion(WORKSPACE_ID, suggestionId)).toBe(true);
    const entity = await entityRow("gymshark.com");
    expect(entity).toMatchObject({ id: entityId, state: "on", state_changed_by: "user" });
    const count = await env.DB.prepare("SELECT count(*) AS n FROM entity WHERE domain = 'gymshark.com'").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("refuses a suggestion that is not pending or not this workspace's", async () => {
    const dismissed = await seedSuggestion({ status: "dismissed" });
    expect(await acceptSuggestion(WORKSPACE_ID, dismissed)).toBe(false);

    await seedWorkspace("ws-other", "user-2");
    const foreign = await seedSuggestion({ workspaceId: "ws-other", domain: "elsewhere.com" });
    expect(await acceptSuggestion(WORKSPACE_ID, foreign)).toBe(false);
    expect(await entityRow("elsewhere.com")).toBeNull();
  });

  it("fails loudly when the linked entity is not a row in this workspace", async () => {
    await seedWorkspace("ws-other", "user-2");
    const foreignEntityId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, origin, state, created_at)
       VALUES (?, 'ws-other', 'competitor', 'gymshark.com', 'Gymshark', 'auto', 'off', ?)`,
    )
      .bind(foreignEntityId, NOW)
      .run();
    const suggestionId = await seedSuggestion({ domain: "gymshark.com", entityId: foreignEntityId });

    await expect(acceptSuggestion(WORKSPACE_ID, suggestionId)).rejects.toThrow(/not a row in workspace/);
    expect((await suggestionRow(suggestionId))?.status).toBe("pending");
    expect(await entityRow("gymshark.com")).toBeNull();
  });
});

describe("OnCompetitorList render", () => {
  it("marks each listed brand with its entity row's id", async () => {
    const entityId = await addUserCompetitor(WORKSPACE_ID, {
      domain: "gymshark.com",
      name: "Gymshark",
      now: NOW,
    });
    const rows = await listOnCompetitors(WORKSPACE_ID);
    const html = renderToStaticMarkup(createElement(OnCompetitorList, { rows }));
    expect(html).toContain(`data-entity-id="${entityId}"`);
    expect(html).toContain("gymshark.com");
  });
});

describe("markCompetitorsReady", () => {
  it("stamps the newest unstamped run once", async () => {
    await env.DB.prepare(
      `INSERT INTO onboarding_run (id, workspace_id, user_id, input_raw, started_at)
       VALUES ('run-1', ?, ?, 'gymshark.com', ?)`,
    )
      .bind(WORKSPACE_ID, USER_ID, NOW)
      .run();

    await markCompetitorsReady(WORKSPACE_ID, "2026-09-23T08:00:41.000Z");
    const row = await env.DB.prepare("SELECT competitors_ready_at FROM onboarding_run WHERE id = 'run-1'").first<{
      competitors_ready_at: string | null;
    }>();
    expect(row?.competitors_ready_at).toBe("2026-09-23T08:00:41.000Z");

    await markCompetitorsReady(WORKSPACE_ID, "2026-09-23T08:05:00.000Z");
    const again = await env.DB.prepare("SELECT competitors_ready_at FROM onboarding_run WHERE id = 'run-1'").first<{
      competitors_ready_at: string | null;
    }>();
    expect(again?.competitors_ready_at).toBe("2026-09-23T08:00:41.000Z");
  });

  it("is a no-op when the workspace has no run row yet", async () => {
    await expect(markCompetitorsReady(WORKSPACE_ID)).resolves.toBeUndefined();
  });
});

describe("domainFromInput", () => {
  it("normalises domains and URLs, and refuses what it cannot honestly name", () => {
    expect(domainFromInput("gymshark.com")).toBe("gymshark.com");
    expect(domainFromInput("  HTTPS://WWW.Gymshark.com/uk/men?utm=x ")).toBe("gymshark.com");
    expect(domainFromInput("oneractive.com")).toBe("oneractive.com");
    expect(domainFromInput("@gymshark")).toBeNull();
    expect(domainFromInput("gymshark")).toBeNull();
    expect(domainFromInput("not a domain")).toBeNull();
    expect(domainFromInput("")).toBeNull();
  });
});
