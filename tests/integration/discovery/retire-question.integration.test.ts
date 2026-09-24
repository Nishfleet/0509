import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { handleCompetitorIntent } from "../../../app/lib/competitors.server";
import { readCompetitors } from "../../../app/lib/data/entity.server";
import {
  confirmRetireSuggestion,
  keepFromRetireSuggestion,
} from "../../../app/lib/data/suggestion.server";

const NOW = "2026-09-24T06:00:00.000Z";

let runs = 0;

interface EntityRow {
  id: string;
  domain: string;
  state: string;
  state_changed_by: string | null;
}

interface SuggestionRow {
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  entity_id: string | null;
}

async function seedWorkspace(name: string): Promise<string> {
  runs += 1;
  const userId = `user-retire-${String(runs)}`;
  const workspaceId = `ws-retire-${String(runs)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 1, ?4, ?4)',
    ).bind(userId, name, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, ?2, ?3, 'UTC', 1, 8, ?4)",
    ).bind(workspaceId, name, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?1, ?2, 'self', ?3, ?4, ?5)",
    ).bind(`${workspaceId}-self`, workspaceId, `${workspaceId}-self.example`, name, NOW),
  ]);
  return workspaceId;
}

async function seedCompetitor(
  workspaceId: string,
  domain: string,
  name: string,
): Promise<string> {
  const entityId = `${workspaceId}-${domain}`;
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, 'on', ?5)",
  )
    .bind(entityId, workspaceId, domain, name, NOW)
    .run();
  return entityId;
}

async function seedRetireSuggestion(
  workspaceId: string,
  entityId: string | null,
  domain: string,
  reason: string | null,
): Promise<string> {
  const suggestionId = `sug-retire-${String(runs)}-${domain.split(".")[0]}`;
  await env.DB.prepare(
    `INSERT INTO suggestion (id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
       verdict_reason, status, created_at)
     VALUES (?1, ?2, ?3, 'retire', ?4, ?4, ?5, 'pending', ?6)`,
  )
    .bind(suggestionId, workspaceId, entityId, domain, reason, NOW)
    .run();
  return suggestionId;
}

async function seedAddSuggestion(workspaceId: string, domain: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO suggestion (id, workspace_id, entity_id, kind, candidate_domain, candidate_name,
       status, created_at)
     VALUES (?1, ?2, NULL, 'add', ?3, ?4, 'pending', ?5)`,
  )
    .bind(`sug-add-${String(runs)}-${domain.split(".")[0]}`, workspaceId, domain, name, NOW)
    .run();
}

async function entityRow(entityId: string): Promise<EntityRow | null> {
  return env.DB.prepare(
    "SELECT id, domain, state, state_changed_by FROM entity WHERE id = ?",
  )
    .bind(entityId)
    .first<EntityRow>();
}

async function suggestionRow(suggestionId: string): Promise<SuggestionRow | null> {
  return env.DB.prepare("SELECT status, decided_by, decided_at, entity_id FROM suggestion WHERE id = ?")
    .bind(suggestionId)
    .first<SuggestionRow>();
}

function intentForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

describe("retire questions in readCompetitors", () => {
  it("lists pending retire questions beside the maybes", async () => {
    const workspaceId = await seedWorkspace("Quietone");
    const first = await seedCompetitor(workspaceId, "quiet-one.example", "Quiet One");
    const second = await seedCompetitor(workspaceId, "quiet-two.example", "");
    const q1 = await seedRetireSuggestion(workspaceId, first, "quiet-one.example", "Quiet for the last 30 days");
    const q2 = await seedRetireSuggestion(workspaceId, second, "quiet-two.example", null);
    await seedAddSuggestion(workspaceId, "fresh.example", "Fresh");

    const { questions, maybes } = await readCompetitors(workspaceId);

    expect(questions).toEqual([
      {
        suggestionId: q1,
        entityId: first,
        name: "Quiet One",
        domain: "quiet-one.example",
        reason: "Quiet for the last 30 days",
      },
      {
        suggestionId: q2,
        entityId: second,
        name: "quiet-two.example",
        domain: "quiet-two.example",
        reason: null,
      },
    ]);
    expect(maybes.map((row) => row.domain)).toEqual(["fresh.example"]);
  });

  it("drops the question and turns the competitor off when the owner stops tracking", async () => {
    const workspaceId = await seedWorkspace("Stopone");
    const entityId = await seedCompetitor(workspaceId, "stop-one.example", "Stop One");
    const q1 = await seedRetireSuggestion(workspaceId, entityId, "stop-one.example", "Quiet for the last 30 days");

    await handleCompetitorIntent(workspaceId, intentForm({ intent: "stop", suggestionId: q1 }));

    const entity = await entityRow(entityId);
    expect(entity).toMatchObject({
      state: "off",
      state_changed_by: "user",
    });
    expect(entity?.state_changed_by).toBe("user");
    const suggestion = await suggestionRow(q1);
    expect(suggestion).toMatchObject({ status: "accepted", decided_by: "user" });
    expect(suggestion?.decided_at).not.toBeNull();
    expect((await readCompetitors(workspaceId)).questions).toEqual([]);
  });

  it("dismisses the question and leaves the competitor on when the owner keeps it", async () => {
    const workspaceId = await seedWorkspace("Keepone");
    const entityId = await seedCompetitor(workspaceId, "keep-one.example", "Keep One");
    const q2 = await seedRetireSuggestion(workspaceId, entityId, "keep-one.example", "Quiet for the last 30 days");

    await handleCompetitorIntent(workspaceId, intentForm({ intent: "keep", suggestionId: q2 }));

    const entity = await entityRow(entityId);
    expect(entity).toMatchObject({ state: "on" });
    const suggestion = await suggestionRow(q2);
    expect(suggestion).toMatchObject({ status: "dismissed", decided_by: "user" });
    expect(suggestion?.decided_at).not.toBeNull();
    expect((await readCompetitors(workspaceId)).questions).toEqual([]);
  });

  it("changes nothing when the suggestion belongs to another workspace", async () => {
    const owner = await seedWorkspace("Ownerws");
    const other = await seedWorkspace("Otherws");
    const entityId = await seedCompetitor(owner, "cross-owner.example", "Cross Owner");
    const otherEntityId = await seedCompetitor(other, "cross-other.example", "Cross Other");
    const foreign = await seedRetireSuggestion(other, otherEntityId, "cross-other.example", "Quiet for the last 30 days");

    await handleCompetitorIntent(owner, intentForm({ intent: "stop", suggestionId: foreign }));

    expect(await entityRow(entityId)).toMatchObject({ state: "on" });
    expect(await entityRow(otherEntityId)).toMatchObject({ state: "on" });
    expect((await suggestionRow(foreign))?.status).toBe("pending");
  });

  it("ignores a stop that has no suggestionId", async () => {
    const workspaceId = await seedWorkspace("Noid");
    const entityId = await seedCompetitor(workspaceId, "noid.example", "No Id");
    const q = await seedRetireSuggestion(workspaceId, entityId, "noid.example", null);

    const result = await handleCompetitorIntent(workspaceId, intentForm({ intent: "stop" }));

    expect(result).toEqual({ message: null });
    expect((await entityRow(entityId))?.state).toBe("on");
    expect((await suggestionRow(q))?.status).toBe("pending");
  });

  it("leaves an already decided suggestion alone on a second stop", async () => {
    const workspaceId = await seedWorkspace("Twice");
    const entityId = await seedCompetitor(workspaceId, "twice.example", "Twice");
    const q = await seedRetireSuggestion(workspaceId, entityId, "twice.example", "Quiet for the last 30 days");

    await confirmRetireSuggestion({ workspaceId, suggestionId: q, now: NOW });
    await confirmRetireSuggestion({ workspaceId, suggestionId: q, now: "2026-09-24T07:00:00.000Z" });

    const suggestion = await suggestionRow(q);
    expect(suggestion).toMatchObject({ status: "accepted", decided_at: NOW });
    expect(await entityRow(entityId)).toMatchObject({ state: "off" });
  });

  it("keeps the entity on for a second keep call", async () => {
    const workspaceId = await seedWorkspace("Keepagain");
    const entityId = await seedCompetitor(workspaceId, "keep-again.example", "Keep Again");
    const q = await seedRetireSuggestion(workspaceId, entityId, "keep-again.example", null);

    await keepFromRetireSuggestion({ workspaceId, suggestionId: q, now: NOW });
    await keepFromRetireSuggestion({ workspaceId, suggestionId: q, now: "2026-09-24T07:00:00.000Z" });

    expect(await entityRow(entityId)).toMatchObject({ state: "on" });
    const suggestion = await suggestionRow(q);
    expect(suggestion).toMatchObject({ status: "dismissed", decided_at: NOW });
  });
});
