import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { countOtherOnCompetitors, readEntityDomain, readSelfEntityId } from "../../../app/lib/data/entity.server";

const NOW = "2026-10-05T00:00:00.000Z";

async function seedWorkspace(workspaceId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 0, ?3, ?3)`,
  )
    .bind(userId, `${userId}@0509.io`, NOW)
    .run();
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)`)
    .bind(workspaceId, userId, NOW)
    .run();
}

async function insertEntity(row: {
  id: string;
  workspaceId: string;
  role: "self" | "competitor";
  domain: string;
  name?: string | null;
  state?: "on" | "off" | "dismissed";
}): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(row.id, row.workspaceId, row.role, row.domain, row.name ?? null, row.state ?? "on", NOW)
    .run();
}

async function cleanup(entityIds: string[], workspaceIds: string[], userIds: string[]): Promise<void> {
  for (const id of entityIds) await env.DB.prepare("DELETE FROM entity WHERE id = ?1").bind(id).run();
  for (const id of workspaceIds) await env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(id).run();
  for (const id of userIds) await env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(id).run();
}

describe("entity data layer row parsing", () => {
  it("readEntityDomain returns the domain for its own workspace, and null otherwise", async () => {
    const suffix = crypto.randomUUID();
    const userId = `user-domain-${suffix}`;
    const otherUserId = `user-domain-other-${suffix}`;
    const workspaceId = `ws-domain-${suffix}`;
    const otherWorkspaceId = `ws-domain-other-${suffix}`;
    await seedWorkspace(workspaceId, userId);
    await seedWorkspace(otherWorkspaceId, otherUserId);
    await insertEntity({
      id: `entity-domain-${suffix}`,
      workspaceId,
      role: "self",
      domain: "mine.example",
    });

    try {
      expect(await readEntityDomain(workspaceId, `entity-domain-${suffix}`)).toBe("mine.example");
      expect(await readEntityDomain(otherWorkspaceId, `entity-domain-${suffix}`)).toBeNull();
      expect(await readEntityDomain(workspaceId, `entity-domain-missing-${suffix}`)).toBeNull();
    } finally {
      await cleanup(
        [`entity-domain-${suffix}`],
        [workspaceId, otherWorkspaceId],
        [userId, otherUserId],
      );
    }
  });

  it("readSelfEntityId returns the id only for a self entity in the workspace", async () => {
    const suffix = crypto.randomUUID();
    const userId = `user-selfid-${suffix}`;
    const otherUserId = `user-selfid-other-${suffix}`;
    const workspaceId = `ws-selfid-${suffix}`;
    const otherWorkspaceId = `ws-selfid-other-${suffix}`;
    await seedWorkspace(workspaceId, userId);
    await seedWorkspace(otherWorkspaceId, otherUserId);
    await insertEntity({ id: `entity-self-${suffix}`, workspaceId, role: "self", domain: "mine.example" });
    await insertEntity({ id: `entity-rival-${suffix}`, workspaceId, role: "competitor", domain: "rival.example" });

    try {
      expect(await readSelfEntityId(workspaceId, `entity-self-${suffix}`)).toBe(`entity-self-${suffix}`);
      expect(await readSelfEntityId(workspaceId, `entity-rival-${suffix}`)).toBeNull();
      expect(await readSelfEntityId(otherWorkspaceId, `entity-self-${suffix}`)).toBeNull();
    } finally {
      await cleanup(
        [`entity-self-${suffix}`, `entity-rival-${suffix}`],
        [workspaceId, otherWorkspaceId],
        [userId, otherUserId],
      );
    }
  });

  it("countOtherOnCompetitors counts on competitors except the named domain", async () => {
    const suffix = crypto.randomUUID();
    const userId = `user-count-${suffix}`;
    const otherUserId = `user-count-other-${suffix}`;
    const workspaceId = `ws-count-${suffix}`;
    const otherWorkspaceId = `ws-count-other-${suffix}`;
    await seedWorkspace(workspaceId, userId);
    await seedWorkspace(otherWorkspaceId, otherUserId);
    await insertEntity({ id: `entity-count-a-${suffix}`, workspaceId, role: "competitor", domain: "a.example" });
    await insertEntity({ id: `entity-count-b-${suffix}`, workspaceId, role: "competitor", domain: "b.example" });
    await insertEntity({
      id: `entity-count-off-${suffix}`,
      workspaceId,
      role: "competitor",
      domain: "off.example",
      state: "off",
    });
    await insertEntity({ id: `entity-count-other-${suffix}`, workspaceId: otherWorkspaceId, role: "competitor", domain: "c.example" });

    try {
      expect(await countOtherOnCompetitors(workspaceId, "a.example")).toBe(1);
      expect(await countOtherOnCompetitors(workspaceId, "z.example")).toBe(2);
      expect(await countOtherOnCompetitors(otherWorkspaceId, "a.example")).toBe(1);
    } finally {
      await cleanup(
        [
          `entity-count-a-${suffix}`,
          `entity-count-b-${suffix}`,
          `entity-count-off-${suffix}`,
          `entity-count-other-${suffix}`,
        ],
        [workspaceId, otherWorkspaceId],
        [userId, otherUserId],
      );
    }
  });
});
