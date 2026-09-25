import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  insertSelfEntity,
  markSelfSiteFill,
  readSelfSiteFill,
} from "../../../app/lib/data/entity.server";

const NOW = "2026-09-25T08:00:00Z";

let entityId = "";
let userId = "";
let workspaceId = "";

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

beforeEach(() => {
  const suffix = crypto.randomUUID();
  entityId = `entity-site-fill-read-${suffix}`;
  userId = `user-site-fill-read-${suffix}`;
  workspaceId = `ws-site-fill-read-${suffix}`;
});

afterEach(async () => {
  await env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(userId).run();
});

describe("readSelfSiteFill", () => {
  it("reads the self card's site-fill state for its workspace", async () => {
    await seed();
    expect(await readSelfSiteFill(workspaceId)).toBe(null);

    await markSelfSiteFill(entityId, "pending");
    expect(await readSelfSiteFill(workspaceId)).toBe("pending");

    await markSelfSiteFill(entityId, "gave_up");
    expect(await readSelfSiteFill(workspaceId)).toBe("gave_up");
  });

  it("returns null for a workspace with no self entity", async () => {
    expect(await readSelfSiteFill(`ws-empty-${crypto.randomUUID()}`)).toBe(null);
  });
});
