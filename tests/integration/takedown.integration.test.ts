import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { isTakenDown, takenDownAmong } from "../../app/lib/data/takedown.server";

const NOW = "2026-09-24T00:00:00Z";
const LATER = "2026-09-24T01:00:00Z";

async function seedWorkspace(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)`,
  )
    .bind(`user-${id}`, "Owner", `${id}@0509.io`, NOW, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, "Owner", `user-${id}`, NOW)
    .run();
}

function insertEntity(id: string, workspaceId: string, role: string, domain: string, state = "on") {
  return env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, workspaceId, role, domain, domain === "removed.example" ? "Removed Co" : null, state, NOW);
}

function insertSuggestion(id: string, workspaceId: string, domain: string) {
  return env.DB.prepare(
    `INSERT INTO suggestion (id, workspace_id, kind, candidate_domain, status, created_at) VALUES (?, ?, 'add', ?, 'pending', ?)`,
  ).bind(id, workspaceId, domain, NOW);
}

function recordTakedown(subject: string) {
  return env.DB.prepare(
    `INSERT INTO takedown (subject, requested_at, actioned_at, actioned_by) VALUES (?, ?, ?, 'nish')`,
  ).bind(subject, NOW, LATER);
}

beforeEach(async () => {
  for (const table of ["alert", "suggestion", "entity", "takedown", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await seedWorkspace("ws-a");
  await seedWorkspace("ws-b");
});

describe("recording a takedown", () => {
  it("dismisses the subject in every workspace, notes each owner, and clears pending suggestions", async () => {
    await env.DB.batch([
      insertEntity("ent-a", "ws-a", "competitor", "removed.example"),
      insertEntity("ent-b", "ws-b", "competitor", "removed.example", "off"),
      insertEntity("ent-other", "ws-a", "competitor", "kept.example"),
      insertSuggestion("sug-a", "ws-a", "removed.example"),
    ]);

    await recordTakedown("removed.example").run();

    const { results: entities } = await env.DB.prepare(
      "SELECT id, state, state_reason, state_changed_by, state_changed_at FROM entity ORDER BY id",
    ).all();
    expect(entities).toEqual([
      { id: "ent-a", state: "dismissed", state_reason: "takedown", state_changed_by: "auto", state_changed_at: LATER },
      { id: "ent-b", state: "dismissed", state_reason: "takedown", state_changed_by: "auto", state_changed_at: LATER },
      { id: "ent-other", state: "on", state_reason: null, state_changed_by: null, state_changed_at: null },
    ]);

    const { results: alerts } = await env.DB.prepare(
      "SELECT workspace_id, entity_id, kind, title, created_at FROM alert ORDER BY workspace_id",
    ).all();
    expect(alerts).toEqual([
      {
        workspace_id: "ws-a",
        entity_id: "ent-a",
        kind: "takedown",
        title: "Removed Co asked to be removed from tracking, so we stopped tracking it.",
        created_at: LATER,
      },
      {
        workspace_id: "ws-b",
        entity_id: "ent-b",
        kind: "takedown",
        title: "Removed Co asked to be removed from tracking, so we stopped tracking it.",
        created_at: LATER,
      },
    ]);

    const suggestion = await env.DB.prepare("SELECT status, decided_by FROM suggestion WHERE id = 'sug-a'").first();
    expect(suggestion).toEqual({ status: "dismissed", decided_by: "takedown" });
    expect(await isTakenDown("removed.example")).toBe(true);
    expect(await isTakenDown("kept.example")).toBe(false);
  });

  it("leaves a workspace's own brand alone", async () => {
    await insertEntity("ent-self", "ws-a", "self", "removed.example").run();
    await recordTakedown("removed.example").run();
    const self = await env.DB.prepare("SELECT state FROM entity WHERE id = 'ent-self'").first();
    expect(self).toEqual({ state: "on" });
    const alerts = await env.DB.prepare("SELECT count(*) AS n FROM alert").first();
    expect(alerts).toEqual({ n: 0 });
  });
});

describe("after a takedown", () => {
  beforeEach(async () => {
    await insertEntity("ent-a", "ws-a", "competitor", "removed.example").run();
    await recordTakedown("removed.example").run();
  });

  it("no workspace can add the subject again, and the rest of the batch still lands", async () => {
    await env.DB.batch([
      insertEntity("ent-new", "ws-b", "competitor", "removed.example"),
      insertEntity("ent-kept", "ws-b", "competitor", "kept.example"),
    ]);
    const { results } = await env.DB.prepare("SELECT id FROM entity WHERE workspace_id = 'ws-b'").all();
    expect(results).toEqual([{ id: "ent-kept" }]);
  });

  it("discovery cannot suggest the subject", async () => {
    await insertSuggestion("sug-b", "ws-b", "removed.example").run();
    const count = await env.DB.prepare("SELECT count(*) AS n FROM suggestion").first();
    expect(count).toEqual({ n: 0 });
  });

  it("a dismissed row cannot be turned back on", async () => {
    await env.DB.prepare("UPDATE entity SET state = 'on', state_reason = NULL WHERE id = 'ent-a'").run();
    const row = await env.DB.prepare("SELECT state, state_reason FROM entity WHERE id = 'ent-a'").first();
    expect(row).toEqual({ state: "dismissed", state_reason: "takedown" });
  });

  it("the takedown row is never duplicated", async () => {
    await expect(recordTakedown("removed.example").run()).rejects.toThrow(/UNIQUE|PRIMARY/);
  });

  it("takenDownAmong returns only the taken-down domains", async () => {
    expect(await takenDownAmong(["removed.example", "kept.example"])).toEqual(new Set(["removed.example"]));
    expect(await takenDownAmong([])).toEqual(new Set());
  });
});
