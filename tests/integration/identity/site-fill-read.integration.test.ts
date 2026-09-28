import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fillSelfSiteFields,
  insertSelfEntity,
  markSelfSiteFill,
  readEntityIdentityJson,
  readSelfSiteFill,
} from "../../../app/lib/data/entity.server";

const NOW = "2026-09-25T08:00:00Z";

let selfId = "";
let otherId = "";
let userId = "";
let workspaceId = "";
let otherWorkspaceId = "";

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
    id: selfId,
    workspaceId,
    domain: "gymshark.com",
    name: "Gymshark",
    identityJson: JSON.stringify({ description: null, socials: [] }),
    now: NOW,
  });
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 0, ?3, ?3)`,
  )
    .bind(`${userId}-b`, `${userId}-b@0509.io`, NOW)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)`,
  )
    .bind(otherWorkspaceId, `${userId}-b`, NOW)
    .run();
  await insertSelfEntity({
    id: otherId,
    workspaceId: otherWorkspaceId,
    domain: "gymbro.example",
    name: "Gymbro",
    identityJson: JSON.stringify({ description: "Theirs", socials: [] }),
    now: NOW,
  });
}

beforeEach(() => {
  const suffix = crypto.randomUUID();
  selfId = `entity-site-fill-read-${suffix}`;
  otherId = `entity-site-fill-read-other-${suffix}`;
  userId = `user-site-fill-read-${suffix}`;
  workspaceId = `ws-site-fill-read-${suffix}`;
  otherWorkspaceId = `ws-site-fill-read-other-${suffix}`;
});

afterEach(async () => {
  await env.DB.prepare('DELETE FROM "user" WHERE id = ?1 OR id = ?2').bind(userId, `${userId}-b`).run();
});

describe("readSelfSiteFill", () => {
  it("reads the self card's site-fill state for its workspace", async () => {
    await seed();
    expect(await readSelfSiteFill(workspaceId)).toBe(null);

    await markSelfSiteFill(workspaceId, selfId, "pending");
    expect(await readSelfSiteFill(workspaceId)).toBe("pending");

    await markSelfSiteFill(workspaceId, selfId, "gave_up");
    expect(await readSelfSiteFill(workspaceId)).toBe("gave_up");
  });

  it("returns null for a workspace with no self entity", async () => {
    expect(await readSelfSiteFill(`ws-empty-${crypto.randomUUID()}`)).toBe(null);
  });

  it("returns nothing for another workspace's entity, on every helper", async () => {
    await seed();
    const theirs = JSON.stringify({ description: "Theirs", socials: [] });
    expect(await readEntityIdentityJson(otherWorkspaceId, otherId)).toBe(theirs);
    expect(await readEntityIdentityJson(workspaceId, otherId)).toBeNull();
    expect(await readEntityIdentityJson(otherWorkspaceId, selfId)).toBeNull();

    await fillSelfSiteFields({
      workspaceId,
      entityId: otherId,
      description: "Leaked",
      socialsJson: "[]",
    });
    expect(await readEntityIdentityJson(otherWorkspaceId, otherId)).toBe(theirs);

    await markSelfSiteFill(workspaceId, otherId, "gave_up");
    expect(await readSelfSiteFill(otherWorkspaceId)).toBe(null);
    expect(await readEntityIdentityJson(otherWorkspaceId, otherId)).toBe(theirs);
    expect(await readEntityIdentityJson(workspaceId, selfId)).toBe(
      JSON.stringify({ description: null, socials: [] }),
    );
  });
});
