import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { insertSelfEntity } from "../../../app/lib/data/entity.server";
import { insertFieldEdits, readEditedFields } from "../../../app/lib/data/user_decision.server";

const NOW = "2026-09-25T10:30:00Z";
const FIELDS_VERDICT = "identity_field:edited";

let entityId = "";
let userId = "";
let workspaceId = "";

beforeEach(async () => {
  for (const table of ["user_decision", "entity", "workspace", '"user"']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  const suffix = crypto.randomUUID();
  entityId = `entity-field-edit-${suffix}`;
  userId = `user-field-edit-${suffix}`;
  workspaceId = `ws-field-edit-${suffix}`;
});

async function seed(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 0, ?3, ?3)`,
  )
    .bind(userId, `${userId}@0509.io`, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)`,
  )
    .bind(workspaceId, userId, NOW)
    .run();
  await insertSelfEntity({
    id: entityId,
    workspaceId,
    domain: "gymshark.com",
    name: "Gymshark",
    identityJson: JSON.stringify({ description: null, socials: [] }),
    now: NOW,
  });
}

async function userDecisionsRow(): Promise<{
  verdict: string;
  note: string;
  workspace_id: string;
  user_id: string;
  entity_id: string;
} | null> {
  return await env.DB.prepare(
    "SELECT verdict, note, workspace_id, user_id, entity_id FROM user_decision WHERE entity_id = ?1",
  )
    .bind(entityId)
    .first<{ verdict: string; note: string; workspace_id: string; user_id: string; entity_id: string }>();
}

describe("field-edit decisions", () => {
  it("records one row per edited field with the JSON note shape", async () => {
    await seed();

    await insertFieldEdits([
      {
        workspaceId,
        userId,
        entityId,
        edit: { field: "name", from: "Gymshark Ltd", to: "Gymshark" },
        decidedAt: NOW,
      },
    ]);

    expect(await readEditedFields(entityId)).toEqual(["name"]);
    const row = await userDecisionsRow();
    expect(row?.verdict).toBe(FIELDS_VERDICT);
    expect(JSON.parse(row?.note ?? "null")).toEqual({
      field: "name",
      from: "Gymshark Ltd",
      to: "Gymshark",
    });
    expect(row?.workspace_id).toBe(workspaceId);
    expect(row?.user_id).toBe(userId);
    expect(row?.entity_id).toBe(entityId);
  });

  it("returns empty when the entity has no field-edit rows", async () => {
    await seed();

    expect(await readEditedFields(entityId)).toEqual([]);
  });

  it("ignores a row whose note is not JSON", async () => {
    await seed();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)`,
    )
      .bind(crypto.randomUUID(), workspaceId, userId, entityId, FIELDS_VERDICT, "not json", NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO user_decision (id, workspace_id, user_id, signal_id, entity_id, verdict, note, decided_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7)`,
    )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        userId,
        entityId,
        FIELDS_VERDICT,
        JSON.stringify({ from: "a", to: "b" }),
        NOW,
      )
      .run();

    expect(await readEditedFields(entityId)).toEqual([]);
  });
});
