import { env, introspectWorkflow } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { confirmCard } from "../../../app/lib/identity/confirm.server";
import { normaliseSubject } from "../../../app/lib/identity/normalise";
import { probeKey } from "../../../app/lib/identity/probe-cache.server";

const DOMAIN = "gymshark.com";
const GREENHOUSE_JOBS = "https://boards-api.greenhouse.io/v1/boards/gymshark/jobs";
const PRICING = "https://www.gymshark.com/pricing";
const BOARD = "https://boards.greenhouse.io/gymshark";
const AD_ID = "12345";
const ADVERTISER = "Gymshark Ads";

const outcomeSchema = z.object({
  entityId: z.string(),
  watches: z.array(z.object({ id: z.string(), sourceKey: z.string(), targetKey: z.string() })),
  discoveryInstanceId: z.string(),
  queued: z.array(z.string()),
  r2Keys: z.array(z.string()),
  siteFill: z.enum(["filled", "gave_up"]).nullable(),
});

let runs = 0;
let userId = "";
let workspaceId = "";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function subject() {
  const normalised = normaliseSubject(DOMAIN);
  if (!normalised.ok) throw new Error("gymshark.com must normalise");
  return normalised.subject;
}

async function seed(): Promise<void> {
  const now = "2026-09-25T08:00:00Z";
  await env.DB.prepare(
    `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'Owner', ?2, 0, ?3, ?3)`,
  )
    .bind(userId, `${userId}@0509.io`, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)`,
  )
    .bind(workspaceId, userId, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
     VALUES ('src_ads_meta_tail', 'ads.meta', 'ads', 'meta', 'ads.meta', 'official_api', 1, '{}')`,
  ).run();
  await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE id = 'src_hiring_greenhouse'").run();
  await env.IDENTITY_CACHE.put(
    probeKey(subject(), "homepage"),
    JSON.stringify({
      name: "Gymshark",
      description: "Gym clothes",
      socials: [],
      logoCandidates: { ldOrganizationLogo: null, ogImage: null, appleTouchIcon: null },
      adLibraryHints: [`https://www.facebook.com/ads/library/?id=${AD_ID}`, ADVERTISER],
      navLinks: [PRICING, BOARD],
    }),
  );
}

async function storedIdentity(entityId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare("SELECT identity_json FROM entity WHERE id = ?1")
    .bind(entityId)
    .first<{ identity_json: string }>();
  if (row === null) throw new Error("confirmed card was not stored");
  return JSON.parse(row.identity_json) as Record<string, unknown>;
}

async function confirmedEntityId(): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM entity WHERE workspace_id = ?1 AND role = 'self'")
    .bind(workspaceId)
    .first<{ id: string }>();
  if (row === null) throw new Error("confirmed card was not stored");
  return row.id;
}

beforeEach(() => {
  runs += 1;
  userId = `user-tail-retry-${String(runs)}`;
  workspaceId = `ws-tail-retry-${String(runs)}`;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === GREENHOUSE_JOBS) {
      return Promise.resolve(
        new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("", { status: 200 }));
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await env.IDENTITY_CACHE.delete(probeKey(subject(), "homepage"));
  await env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(userId).run();
  await env.DB.prepare("DELETE FROM source WHERE id = 'src_ads_meta_tail'").run();
  await env.DB.prepare("UPDATE source SET is_enabled = 0 WHERE id = 'src_hiring_greenhouse'").run();
});

describe("IdentityTailWorkflow site-fill retry", () => {
  it("fills the card on a later hourly attempt", async () => {
    await seed();
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    await introspector.modifyAll(async (modifier) => {
      await modifier.disableSleeps();
      await modifier.mockStepResult({ name: "site-reached" }, false);
      await modifier.mockStepResult({ name: "site-fill-1" }, "pending");
    });
    expect(
      await confirmCard(workspaceId, form({ subject: DOMAIN, name: "Gymshark", description: "" })),
    ).toBe(true);

    const entityId = await confirmedEntityId();
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("tail instance was not started");
    await instance.waitForStatus("complete");
    const output = outcomeSchema.parse(await instance.getOutput());

    expect(output.siteFill).toBe("filled");
    expect(await storedIdentity(entityId)).toMatchObject({
      description: "Gym clothes",
      siteFill: "filled",
    });
  });

  it("gives up after 24 hourly attempts", async () => {
    await seed();
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    await introspector.modifyAll(async (modifier) => {
      await modifier.disableSleeps();
      await modifier.mockStepResult({ name: "site-reached" }, false);
      for (let n = 1; n <= 24; n += 1) {
        await modifier.mockStepResult({ name: `site-fill-${String(n)}` }, "pending");
      }
    });
    expect(
      await confirmCard(workspaceId, form({ subject: DOMAIN, name: "Gymshark", description: "" })),
    ).toBe(true);

    const entityId = await confirmedEntityId();
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("tail instance was not started");
    await instance.waitForStatus("complete");
    const output = outcomeSchema.parse(await instance.getOutput());

    expect(output.siteFill).toBe("gave_up");
    expect(await storedIdentity(entityId)).toMatchObject({
      description: null,
      siteFill: "gave_up",
    });
  });

  it("skips the retry leg when the site answered at onboarding", async () => {
    await seed();
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    expect(
      await confirmCard(workspaceId, form({ subject: DOMAIN, name: "Gymshark", description: "" })),
    ).toBe(true);

    const entityId = await confirmedEntityId();
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("tail instance was not started");
    await instance.waitForStatus("complete");
    const output = outcomeSchema.parse(await instance.getOutput());

    expect(output.siteFill).toBeNull();
    const stored = await env.DB.prepare(
      "SELECT json_extract(identity_json, '$.siteFill') AS site_fill FROM entity WHERE id = ?1",
    )
      .bind(entityId)
      .first<{ site_fill: string | null }>();
    if (stored === null) throw new Error("confirmed card was not stored");
    expect(stored.site_fill).toBeNull();
  });
});
