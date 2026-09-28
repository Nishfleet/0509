import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { readCompetitors } from "../../app/lib/data/entity.server";

const NOW = "2026-09-24T06:00:00.000Z";

async function seedWorkspace(): Promise<string> {
  const userId = "user-competitors-order";
  const workspaceId = "ws-competitors-order";
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', 'gymshark.com', 'Gymshark', '{}', ?3)",
    ).bind(`${workspaceId}-self`, workspaceId, NOW),
  ]);
  return workspaceId;
}

async function insertCompetitor(row: {
  id: string;
  workspaceId: string;
  domain: string;
  origin: "manual" | "auto";
  state: "on" | "off";
  createdAt: string;
}) {
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, name, origin, confirmed_at, state, state_changed_at, state_changed_by, created_at) VALUES (?1, ?2, 'competitor', ?3, ?3, ?4, ?5, ?6, ?5, 'user', ?5)",
  )
    .bind(row.id, row.workspaceId, row.domain, row.origin, row.createdAt, row.state)
    .run();
}

describe("competitor ordering", () => {
  it("lists the owner's manual brands first, newest first, then discovery, with OFF last", async () => {
    const workspaceId = await seedWorkspace();
    await insertCompetitor({
      id: "comp-auto-old",
      workspaceId,
      domain: "auto-old.com",
      origin: "auto",
      state: "on",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    await insertCompetitor({
      id: "comp-auto-new",
      workspaceId,
      domain: "auto-new.com",
      origin: "auto",
      state: "on",
      createdAt: "2026-09-10T00:00:00.000Z",
    });
    await insertCompetitor({
      id: "comp-manual-old",
      workspaceId,
      domain: "manual-old.com",
      origin: "manual",
      state: "on",
      createdAt: "2026-09-05T00:00:00.000Z",
    });
    await insertCompetitor({
      id: "comp-manual-new",
      workspaceId,
      domain: "manual-new.com",
      origin: "manual",
      state: "on",
      createdAt: "2026-09-20T00:00:00.000Z",
    });
    await insertCompetitor({
      id: "comp-manual-off",
      workspaceId,
      domain: "manual-off.com",
      origin: "manual",
      state: "off",
      createdAt: "2026-09-21T00:00:00.000Z",
    });

    const { competitors } = await readCompetitors(workspaceId);
    expect(competitors.map((c) => c.domain)).toEqual([
      "manual-new.com",
      "manual-old.com",
      "auto-old.com",
      "auto-new.com",
      "manual-off.com",
    ]);
  });
});
