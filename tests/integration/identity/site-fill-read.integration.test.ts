import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  fillSelfSiteFields,
  insertSelfEntity,
  markSelfSiteFill,
  readEntityIdentityJson,
  readSelfSiteFill,
} from "../../../app/lib/data/entity.server";
import { normaliseSubject } from "../../../app/lib/identity/normalise";
import { probeKey } from "../../../app/lib/identity/probe-cache.server";
import { attemptSiteFill, markSiteFill } from "../../../app/lib/identity/site-fill.server";

const NOW = "2026-09-25T08:00:00Z";
const HOMEPAGE = "https://gymshark.com/";
const CARD = {
  name: "Gymshark",
  description: "Gym clothes",
  socials: [],
  logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
  adLibraryHints: [],
  navLinks: [],
};

function key(): string {
  const normalised = normaliseSubject("gymshark.com");
  if (!normalised.ok) throw new Error("gymshark.com must normalise");
  return probeKey(normalised.subject, "homepage");
}

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
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)`)
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
  await env.DB.prepare(`INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)`)
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
  await env.IDENTITY_CACHE.delete(key());
  await env.DB.prepare('DELETE FROM "user" WHERE id = ?1 OR id = ?2').bind(userId, `${userId}-b`).run();
});

describe("readSelfSiteFill", () => {
  it("reads the self card's site-fill state for its workspace", async () => {
    await seed();
    expect(await readSelfSiteFill(workspaceId)).toBe(null);

    expect(await markSelfSiteFill(workspaceId, selfId, "pending")).toBe(true);
    expect(await readSelfSiteFill(workspaceId)).toBe("pending");

    expect(await markSelfSiteFill(workspaceId, selfId, "gave_up")).toBe(true);
    expect(await readSelfSiteFill(workspaceId)).toBe("gave_up");
  });

  const expected = /Invalid option: expected one of/;

  it("throws when $.siteFill holds a string no writer produces", async () => {
    await seed();
    await env.DB.prepare(
      `UPDATE entity SET identity_json = json_set(identity_json, '$.siteFill', 'bogus') WHERE id = ?1`,
    )
      .bind(selfId)
      .run();

    await expect(readSelfSiteFill(workspaceId)).rejects.toThrow(expected);
  });

  it("throws on any non-string value SQLite reports as text", async () => {
    await seed();
    for (const json of ['{"a":1}', "[1,2]", "1", "true"]) {
      await env.DB.prepare(
        `UPDATE entity SET identity_json = json_set(identity_json, '$.siteFill', json(?1)) WHERE id = ?2`,
      )
        .bind(json, selfId)
        .run();
      await expect(readSelfSiteFill(workspaceId)).rejects.toThrow(expected);
    }
  });

  it("returns null for a workspace with no self entity", async () => {
    expect(await readSelfSiteFill(`ws-empty-${crypto.randomUUID()}`)).toBe(null);
  });

  it("throws on a non-string $.siteFill row, instead of repairing it", async () => {
    await seed();
    await env.DB.prepare(
      `UPDATE entity SET identity_json = json_set(identity_json, '$.siteFill', json('12345')) WHERE id = ?1`,
    )
      .bind(selfId)
      .run();
    await expect(readSelfSiteFill(workspaceId)).rejects.toThrow();
  });

  it("returns nothing for another workspace's entity, on every helper", async () => {
    await seed();
    const theirs = JSON.stringify({ description: "Theirs", socials: [] });
    expect(await readEntityIdentityJson(otherWorkspaceId, otherId)).toBe(theirs);
    expect(await readEntityIdentityJson(workspaceId, otherId)).toBeNull();
    expect(await readEntityIdentityJson(otherWorkspaceId, selfId)).toBeNull();

    expect(
      await fillSelfSiteFields({
        workspaceId,
        entityId: otherId,
        description: "Leaked",
        socialsJson: "[]",
      }),
    ).toBe(false);
    expect(await markSelfSiteFill(workspaceId, otherId, "gave_up")).toBe(false);
    expect(await readEntityIdentityJson(otherWorkspaceId, otherId)).toBe(theirs);
    expect(await readSelfSiteFill(otherWorkspaceId)).toBe(null);
    expect(await readEntityIdentityJson(workspaceId, selfId)).toBe(JSON.stringify({ description: null, socials: [] }));
  });

  it("tells a caller that paired the wrong workspace, instead of doing nothing quietly", async () => {
    await seed();
    await env.IDENTITY_CACHE.put(key(), JSON.stringify(CARD));
    await expect(attemptSiteFill(workspaceId, otherId, HOMEPAGE)).rejects.toThrow(
      new RegExp(`self entity ${otherId} is not in workspace ${workspaceId}`),
    );
    await expect(markSiteFill(workspaceId, otherId, "gave_up")).rejects.toThrow(
      new RegExp(`self entity ${otherId} is not in workspace ${workspaceId}`),
    );
    expect(await readEntityIdentityJson(otherWorkspaceId, otherId)).toBe(
      JSON.stringify({ description: "Theirs", socials: [] }),
    );
    expect(await readEntityIdentityJson(workspaceId, selfId)).toBe(JSON.stringify({ description: null, socials: [] }));
  });
});
