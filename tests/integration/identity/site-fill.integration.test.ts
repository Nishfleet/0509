import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { insertSelfEntity, readEntityIdentityJson } from "../../../app/lib/data/entity.server";
import { normaliseSubject } from "../../../app/lib/identity/normalise";
import { probeKey } from "../../../app/lib/identity/probe-cache.server";
import {
  attemptSiteFill,
  markSiteFill,
  siteWasReached,
} from "../../../app/lib/identity/site-fill.server";

const NOW = "2026-09-25T08:00:00Z";
const HOMEPAGE = "https://gymshark.com/";
const SOCIAL = { platform: "instagram", url: "https://instagram.com/gymshark" };
const CARD = {
  name: "Gymshark",
  description: "Gym clothes",
  socials: [SOCIAL],
  logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
  adLibraryHints: [],
  navLinks: [],
};

let entityId = "";
let userId = "";
let workspaceId = "";

function key(): string {
  const normalised = normaliseSubject("gymshark.com");
  if (!normalised.ok) throw new Error("gymshark.com must normalise");
  return probeKey(normalised.subject, "homepage");
}

async function seed(identity: Record<string, unknown>): Promise<void> {
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
    identityJson: JSON.stringify(identity),
    now: NOW,
  });
}

async function identity(): Promise<Record<string, unknown>> {
  const value = await readEntityIdentityJson(entityId);
  if (value === null) throw new Error("self entity was not stored");
  return JSON.parse(value) as Record<string, unknown>;
}

beforeEach(() => {
  const suffix = crypto.randomUUID();
  entityId = `entity-site-fill-${suffix}`;
  userId = `user-site-fill-${suffix}`;
  workspaceId = `ws-site-fill-${suffix}`;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await env.IDENTITY_CACHE.delete(key());
  await env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(userId).run();
});

describe("site fill", () => {
  it("reports whether the homepage probe is cached", async () => {
    await seed({ description: null, socials: [] });

    expect(await siteWasReached(HOMEPAGE)).toBe(false);
    await env.IDENTITY_CACHE.put(key(), JSON.stringify(CARD));
    expect(await siteWasReached(HOMEPAGE)).toBe(true);
  });

  it("fills empty card fields and records the attempt", async () => {
    await seed({ description: null, socials: [] });
    await env.IDENTITY_CACHE.put(key(), JSON.stringify(CARD));

    expect(await attemptSiteFill(entityId, HOMEPAGE)).toBe("filled");
    expect(await identity()).toEqual({
      description: "Gym clothes",
      socials: [SOCIAL],
      siteFill: "filled",
    });
  });

  it("preserves card fields already set by the user", async () => {
    const existing = { platform: "x", url: "https://x.com/me" };
    await seed({ description: "Mine", socials: [existing] });
    await env.IDENTITY_CACHE.put(key(), JSON.stringify(CARD));

    expect(await attemptSiteFill(entityId, HOMEPAGE)).toBe("filled");
    expect(await identity()).toEqual({
      description: "Mine",
      socials: [existing],
      siteFill: "filled",
    });
  });

  it("leaves the card unchanged when the homepage remains unreachable", async () => {
    await seed({ description: null, socials: [] });
    const before = await readEntityIdentityJson(entityId);
    vi.stubGlobal("fetch", () => Promise.reject(new Error("refused")));

    expect(await attemptSiteFill(entityId, HOMEPAGE)).toBe("pending");
    expect(await readEntityIdentityJson(entityId)).toBe(before);
  });

  it("records a terminal fill state without changing card fields", async () => {
    await seed({ description: "Mine", socials: [] });

    await markSiteFill(entityId, "gave_up");

    expect(await identity()).toEqual({
      description: "Mine",
      socials: [],
      siteFill: "gave_up",
    });
  });
});
