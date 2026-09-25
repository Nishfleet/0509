import { env, introspectWorkflow } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { insertSelfEntity } from "../../../app/lib/data/entity.server";
import { upsertJudgedPages } from "../../../app/lib/data/page.server";
import { confirmCard } from "../../../app/lib/identity/confirm.server";
import { normaliseSubject } from "../../../app/lib/identity/normalise";
import { probeKey } from "../../../app/lib/identity/probe-cache.server";
import { identityTailInstanceId, seedTailWatches } from "../../../app/lib/identity/tail.server";

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
});

const watchSchema = z.array(
  z.object({ id: z.string(), source_key: z.string(), target_key: z.string() }),
);

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

async function watches(): Promise<{ id: string; source_key: string; target_key: string }[]> {
  const rows = await env.DB.prepare(
    `SELECT w.id AS id, s.key AS source_key, w.target_key AS target_key
     FROM watch w
     JOIN source s ON s.id = w.source_id
     JOIN entity e ON e.id = w.entity_id
     WHERE e.workspace_id = ?1
     ORDER BY s.key, w.target_key, w.id`,
  )
    .bind(workspaceId)
    .all();
  return watchSchema.parse(rows.results);
}

beforeEach(() => {
  runs += 1;
  userId = `user-tail-${String(runs)}`;
  workspaceId = `ws-tail-${String(runs)}`;
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

describe("IdentityTailWorkflow", () => {
  it("persists the card, seeds watches, starts discovery and queues the first sweep", async () => {
    await seed();
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    expect(
      await confirmCard(
        workspaceId,
        form({ subject: DOMAIN, name: "Gymshark", description: "Gym clothes" }),
      ),
    ).toBe(true);

    const entityId = await env.DB.prepare("SELECT id FROM entity WHERE workspace_id = ?1 AND role = 'self'")
      .bind(workspaceId)
      .first<{ id: string }>();
    if (entityId === null) throw new Error("confirmed card was not stored");
    const instanceId = identityTailInstanceId(entityId.id);
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("tail instance was not started");
    await instance.waitForStatus("complete");
    const output = outcomeSchema.parse(await instance.getOutput());

    expect(output.entityId).toBe(entityId.id);
    expect(output.r2Keys).toEqual([]);
    expect(output.discoveryInstanceId).toBe(`discovery-${workspaceId}-${new Date().toISOString().slice(0, 10)}`);
    const stored = await watches();
    expect(output.watches).toEqual(
      stored.map((row) => ({ id: row.id, sourceKey: row.source_key, targetKey: row.target_key })),
    );
    expect(output.queued).toEqual(stored.map((row) => row.id));
    expect(stored.map((row) => `${row.source_key} ${row.target_key}`)).toEqual([
      `ads.meta ${AD_ID}`,
      `ads.meta ${ADVERTISER}`,
      "gdelt.doc Gymshark",
      `hiring.greenhouse ${BOARD}`,
      "hn.algolia Gymshark",
      "site.web https://gymshark.com/",
      "youtube.channel_rss Gymshark",
    ]);

    const pages = await env.DB.prepare(
      "SELECT role, url FROM page WHERE entity_id = ?1 ORDER BY role, url",
    )
      .bind(entityId.id)
      .all<{ role: string; url: string }>();
    expect(pages.results).toEqual([{ role: "home", url: "https://gymshark.com/" }]);

    const discovery = await env.DISCOVERY.get(output.discoveryInstanceId);
    const discoveryStatus = await discovery.status();
    expect(["queued", "running", "waiting", "waitingForPause", "complete", "errored"]).toContain(
      discoveryStatus.status,
    );
    expect(instanceId).toBe(`identity-tail-${entityId.id}`);
  });

  it("watches the page Jev judged pricing, not a /pricing path", async () => {
    await seed();
    const entityId = `entity-pricing-${String(runs)}`;
    await insertSelfEntity({
      id: entityId,
      workspaceId,
      domain: DOMAIN,
      name: "Gymshark",
      identityJson: "{}",
      now: "2026-09-25T08:00:00Z",
    });
    await upsertJudgedPages([
      {
        id: crypto.randomUUID(),
        entityId,
        url: "https://www.gymshark.com/plans",
        title: "Plans",
        role: "pricing",
        roleDecidedForHash: "h",
        discoveredAt: "2026-09-25T08:00:00Z",
      },
    ]);

    const seeded = await seedTailWatches(
      {
        workspaceId,
        entityId,
        name: "Gymshark",
        domain: DOMAIN,
        homepageUrl: "https://gymshark.com/",
      },
      "2026-09-25T08:00:00Z",
    );

    expect(seeded.map((watch) => watch.targetKey)).toContain("https://www.gymshark.com/plans");
    expect(seeded.map((watch) => watch.targetKey)).not.toContain(PRICING);
  });

  it("seeds a creator's handle mentions and its named website", async () => {
    await seed();
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    expect(
      await confirmCard(
        workspaceId,
        form({
          subject: "https://www.youtube.com/@gymshark",
          name: "Gymshark",
          description: "Gym clothes",
          "social.youtube": "https://www.youtube.com/@gymshark",
          "social.site": "https://gymshark.com/",
        }),
      ),
    ).toBe(true);
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("tail instance was not started");
    await instance.waitForStatus("complete");
    await instance.getOutput();
    const stored = await watches();
    expect(stored.map((row) => `${row.source_key} ${row.target_key}`)).toEqual([
      `ads.meta ${AD_ID}`,
      `ads.meta ${ADVERTISER}`,
      "gdelt.doc @gymshark",
      "gdelt.doc Gymshark",
      `hiring.greenhouse ${BOARD}`,
      "hn.algolia @gymshark",
      "hn.algolia Gymshark",
      "site.web https://gymshark.com/",
      "youtube.channel_rss Gymshark",
    ]);
  });

  it("seeds a creator with no website without any site, ads or hiring watch", async () => {
    await seed();
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    expect(
      await confirmCard(
        workspaceId,
        form({
          subject: "https://www.instagram.com/gymshark/",
          name: "Gymshark",
          description: "",
          "social.instagram": "https://www.instagram.com/gymshark/",
        }),
      ),
    ).toBe(true);
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("tail instance was not started");
    await instance.waitForStatus("complete");
    await instance.getOutput();
    const stored = await watches();
    expect(stored.map((row) => `${row.source_key} ${row.target_key}`)).toEqual([
      "gdelt.doc @gymshark",
      "gdelt.doc Gymshark",
      "hn.algolia @gymshark",
      "hn.algolia Gymshark",
      "youtube.channel_rss Gymshark",
    ]);
  });

  it("retries a failed step and still queues the sweep", async () => {
    await seed();
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    await introspector.modifyAll(async (modifier) => {
      await modifier.disableRetryDelays();
      await modifier.mockStepError({ name: "enqueue-first-sweep" }, new Error("forced step retry"), 1);
    });
    expect(
      await confirmCard(workspaceId, form({ subject: DOMAIN, name: "Gymshark", description: "" })),
    ).toBe(true);
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("tail instance was not started");
    await instance.waitForStatus("complete");
    const output = outcomeSchema.parse(await instance.getOutput());
    const stored = await watches();
    expect(output.queued).toEqual(stored.map((row) => row.id));
    expect(output.queued.length).toBeGreaterThan(0);
    const binding = await env.IDENTITY_TAIL.get(identityTailInstanceId(output.entityId));
    const status = await binding.status();
    expect(status.status).toBe("complete");
  });

  it("gives a step three retries and then stops", async () => {
    await seed();
    await using introspector = await introspectWorkflow(env.IDENTITY_TAIL);
    await introspector.modifyAll(async (modifier) => {
      await modifier.disableRetryDelays();
      await modifier.mockStepError({ name: "persist" }, new Error("forced step retry"), 4);
    });
    expect(
      await confirmCard(workspaceId, form({ subject: DOMAIN, name: "Gymshark", description: "" })),
    ).toBe(true);
    const [instance] = await introspector.get();
    if (instance === undefined) throw new Error("tail instance was not started");
    await instance.waitForStatus("errored");
    const error = await instance.getError();
    expect(error.message).toContain("forced step retry");
  });
});
