import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readOnboardingCompetitors } from "../../app/lib/data/entity.server";
import { acceptSuggestion } from "../../app/lib/data/suggestion.server";

/**
 * Screen 3's write (0509#4429): one maybe flipped on accepts a pending
 * suggestion into an ON competitor, in one batch, against the migrated D1.
 */

let seededRuns = 0;

async function seedUser(id: string, email: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
  )
    .bind(id, email, email, "2026-09-24T12:00:00.000Z", "2026-09-24T12:00:00.000Z")
    .run();
}

async function seedWorkspace(id: string, ownerUserId: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
     VALUES (?, ?, ?, 'UTC', 1, 8, ?)`,
  )
    .bind(id, name, ownerUserId, "2026-09-24T12:00:00.000Z")
    .run();
}

async function seedEntity(input: {
  id: string;
  workspaceId: string;
  role: "self" | "competitor";
  domain: string;
  state: "on" | "off";
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.workspaceId,
      input.role,
      input.domain,
      input.domain,
      input.state,
      "2026-09-24T12:00:00.000Z",
    )
    .run();
}

async function seedSuggestion(input: {
  id: string;
  workspaceId: string;
  entityId: string | null;
  domain: string;
  name: string;
  reason: string | null;
  p: number | null;
  status: "pending" | "accepted" | "dismissed" | "auto_on";
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO suggestion (
       id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
       verdict_reason, verdict_p, status, created_at
     ) VALUES (?, ?, ?, 'add', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      input.workspaceId,
      input.entityId,
      input.domain,
      input.name,
      input.reason,
      input.p,
      input.status,
      "2026-09-24T12:00:00.000Z",
    )
    .run();
}

interface EntityRow {
  id: string;
  role: string;
  domain: string;
  state: string;
  origin: string;
  state_changed_by: string | null;
}

async function entityRows(workspaceId: string, domain: string): Promise<EntityRow[]> {
  const result = await env.DB.prepare(
    "SELECT id, role, domain, state, origin, state_changed_by FROM entity WHERE workspace_id = ? AND domain = ?",
  )
    .bind(workspaceId, domain)
    .all<EntityRow>();
  return result.results;
}

interface SuggestionRow {
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  entity_id: string | null;
}

async function suggestionRow(suggestionId: string): Promise<SuggestionRow | null> {
  return env.DB.prepare(
    "SELECT status, decided_by, decided_at, entity_id FROM suggestion WHERE id = ?",
  )
    .bind(suggestionId)
    .first<SuggestionRow>();
}

describe("acceptSuggestion against migrations/0001_rebuild.sql", () => {
  it("creates the competitor, accepts the suggestion and lists it in on", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-acc-${n}`;
    const workspaceId = `ws-acc-${n}`;
    const domain = `rival-${n}.example`;
    const suggestionId = `sug-acc-${n}`;
    const now = "2026-09-24T09:00:00.000Z";

    await seedUser(userId, `acc-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Accept");
    await seedEntity({
      id: `self-acc-${n}`,
      workspaceId,
      role: "self",
      domain: `self-acc-${n}.example`,
      state: "on",
    });
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      entityId: null,
      domain,
      name: "Rival",
      reason: "Same buyers",
      p: 0.7,
      status: "pending",
    });

    await acceptSuggestion({ workspaceId, suggestionId, now });

    const entities = await entityRows(workspaceId, domain);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      role: "competitor",
      state: "on",
      origin: "auto",
      state_changed_by: "user",
    });

    const suggestion = await suggestionRow(suggestionId);
    expect(suggestion).toMatchObject({
      status: "accepted",
      decided_by: "user",
      decided_at: now,
      entity_id: entities[0].id,
    });

    const result = await readOnboardingCompetitors(workspaceId);
    expect(result.on.map((c) => c.domain)).toEqual([domain]);
    expect(result.on[0]).toMatchObject({ name: "Rival", reason: "Same buyers" });
    expect(result.maybes).toEqual([]);
  });

  it("a second accept changes nothing", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-twice-${n}`;
    const workspaceId = `ws-twice-${n}`;
    const domain = `twice-${n}.example`;
    const suggestionId = `sug-twice-${n}`;
    const now = "2026-09-24T09:00:00.000Z";

    await seedUser(userId, `twice-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Twice");
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      entityId: null,
      domain,
      name: "Twice",
      reason: "Same buyers",
      p: 0.7,
      status: "pending",
    });

    await acceptSuggestion({ workspaceId, suggestionId, now });
    const first = await suggestionRow(suggestionId);
    expect(first?.decided_at).toBe(now);

    await acceptSuggestion({ workspaceId, suggestionId, now: "2026-09-24T10:00:00.000Z" });

    expect(await entityRows(workspaceId, domain)).toHaveLength(1);
    const second = await suggestionRow(suggestionId);
    expect(second?.decided_at).toBe(now);
    expect(second?.entity_id).toBe(first?.entity_id);
  });

  it("flips an existing off competitor back on and points the suggestion at it", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-flip-${n}`;
    const workspaceId = `ws-flip-${n}`;
    const domain = `flip-${n}.example`;
    const entityId = `off-${n}`;
    const suggestionId = `sug-flip-${n}`;

    await seedUser(userId, `flip-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Flip");
    await seedEntity({ id: entityId, workspaceId, role: "competitor", domain, state: "off" });
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      entityId: null,
      domain,
      name: "Flip",
      reason: "Same buyers",
      p: 0.8,
      status: "pending",
    });

    await acceptSuggestion({
      workspaceId,
      suggestionId,
      now: "2026-09-24T09:00:00.000Z",
    });

    const entities = await entityRows(workspaceId, domain);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ id: entityId, state: "on", state_changed_by: "user" });
    expect((await suggestionRow(suggestionId))?.entity_id).toBe(entityId);
  });

  it("never turns a taken-down brand back on, and hides it from the maybes", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-takedown-${n}`;
    const workspaceId = `ws-takedown-${n}`;
    const domain = `takedown-${n}.example`;
    const entityId = `takedown-${n}`;
    const suggestionId = `sug-takedown-${n}`;

    await seedUser(userId, `takedown-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Takedown");
    await env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, state, state_reason, state_changed_by, created_at)
       VALUES (?, ?, 'competitor', ?, ?, 'dismissed', 'takedown', 'auto', ?)`,
    )
      .bind(entityId, workspaceId, domain, domain, "2026-09-24T12:00:00.000Z")
      .run();
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      entityId: null,
      domain,
      name: "Taken down",
      reason: "Same buyers",
      p: 0.9,
      status: "pending",
    });

    expect((await readOnboardingCompetitors(workspaceId)).maybes).toEqual([]);

    await acceptSuggestion({ workspaceId, suggestionId, now: "2026-09-24T09:00:00.000Z" });

    const entities = await env.DB.prepare(
      "SELECT state, state_reason FROM entity WHERE workspace_id = ? AND domain = ?",
    )
      .bind(workspaceId, domain)
      .all<{ state: string; state_reason: string | null }>();
    expect(entities.results).toEqual([{ state: "dismissed", state_reason: "takedown" }]);
    expect((await readOnboardingCompetitors(workspaceId)).on).toEqual([]);
  });

  it("never turns the workspace's own brand into a competitor", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const userId = `user-selfsug-${n}`;
    const workspaceId = `ws-selfsug-${n}`;
    const domain = `selfsug-${n}.example`;
    const suggestionId = `sug-selfsug-${n}`;

    await seedUser(userId, `selfsug-${n}@example.com`);
    await seedWorkspace(workspaceId, userId, "Self");
    await seedEntity({ id: `self-${n}`, workspaceId, role: "self", domain, state: "on" });
    await seedSuggestion({
      id: suggestionId,
      workspaceId,
      entityId: null,
      domain,
      name: "Self",
      reason: "Same buyers",
      p: 0.9,
      status: "pending",
    });

    expect((await readOnboardingCompetitors(workspaceId)).maybes).toEqual([]);

    await acceptSuggestion({ workspaceId, suggestionId, now: "2026-09-24T09:00:00.000Z" });

    expect(await entityRows(workspaceId, domain)).toEqual([
      expect.objectContaining({ role: "self", state: "on" }),
    ]);
  });

  it("a suggestion id from another workspace changes nothing in either", async () => {
    seededRuns += 1;
    const n = String(seededRuns);
    const firstUserId = `user-cross-a-${n}`;
    const firstWorkspaceId = `ws-cross-a-${n}`;
    const secondUserId = `user-cross-b-${n}`;
    const secondWorkspaceId = `ws-cross-b-${n}`;
    const firstDomain = `cross-a-${n}.example`;
    const secondDomain = `cross-b-${n}.example`;
    const secondSuggestionId = `sug-cross-b-${n}`;

    await seedUser(firstUserId, `cross-a-${n}@example.com`);
    await seedUser(secondUserId, `cross-b-${n}@example.com`);
    await seedWorkspace(firstWorkspaceId, firstUserId, "Cross A");
    await seedWorkspace(secondWorkspaceId, secondUserId, "Cross B");
    await seedSuggestion({
      id: `sug-cross-a-${n}`,
      workspaceId: firstWorkspaceId,
      entityId: null,
      domain: firstDomain,
      name: "Cross A",
      reason: "Same buyers",
      p: 0.7,
      status: "pending",
    });
    await seedSuggestion({
      id: secondSuggestionId,
      workspaceId: secondWorkspaceId,
      entityId: null,
      domain: secondDomain,
      name: "Cross B",
      reason: "Same buyers",
      p: 0.7,
      status: "pending",
    });

    await acceptSuggestion({
      workspaceId: firstWorkspaceId,
      suggestionId: secondSuggestionId,
      now: "2026-09-24T09:00:00.000Z",
    });

    expect(await entityRows(firstWorkspaceId, firstDomain)).toHaveLength(0);
    expect(await entityRows(secondWorkspaceId, secondDomain)).toHaveLength(0);
    expect((await suggestionRow(secondSuggestionId))?.status).toBe("pending");
    expect((await suggestionRow(`sug-cross-a-${n}`))?.status).toBe("pending");
  });
});
