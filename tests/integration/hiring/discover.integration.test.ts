import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findBoard,
  planHiringSweep,
} from "../../../app/lib/hiring/sweep.server";

const PAD =
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.";

const USER = "user-hiring-discover";
const WS = "ws-hiring-discover";
const NOW = "2026-09-24T02:00:00Z";

const HOMEPAGE_HTML = `<!doctype html><html><body><h1>Rival</h1><p>${PAD}</p><footer><a href="https://job-boards.greenhouse.io/rival">Careers</a></footer></body></html>`;

const calls: string[] = [];

const seedEntity = (id: string, domain: string, state: "on" | "off") =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', ?, '{}', 'manual', ?, ?)`,
  )
    .bind(id, WS, domain, state, NOW)
    .run();

const listWatches = async () =>
  env.DB.prepare("SELECT id, entity_id, source_id, target_key FROM watch WHERE entity_id IN ('ent-rival','ent-paused') ORDER BY target_key, id").all<{
    id: string;
    entity_id: string;
    source_id: string;
    target_key: string;
  }>();

const listIdentityCache = async (prefix: string) => {
  const listed = await env.IDENTITY_CACHE.list({ prefix });
  const out: { name: string; value: unknown }[] = [];
  for (const key of listed.keys) {
    const value = (await env.IDENTITY_CACHE.get(key.name, "json")) as unknown;
    out.push({ name: key.name, value });
  }
  return out;
};

describe("nightly hiring sweep", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    const listed = await env.IDENTITY_CACHE.list({ prefix: "hiring:" });
    await Promise.all(listed.keys.map((key) => env.IDENTITY_CACHE.delete(key.name)));

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'hiring-discover@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Hiring Discover', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, is_enabled)
       VALUES ('src_hiring_greenhouse', 'hiring.greenhouse', 'hiring', 'greenhouse', 'hiring.board', 1)`,
    ).run();
    await env.DB.exec("UPDATE source SET is_enabled = 1 WHERE id = 'src_hiring_greenhouse'");

    await seedEntity("ent-rival", "rival.com", "on");
    await seedEntity("ent-paused", "paused.com", "off");

    calls.length = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url === "https://rival.com/") {
        return Promise.resolve(new Response(HOMEPAGE_HTML, { status: 200 }));
      }
      if (url === "https://boards-api.greenhouse.io/v1/boards/rival/jobs") {
        return Promise.resolve(
          new Response(JSON.stringify({ jobs: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plans only the on entity and lists its new watch as a target", async () => {
    const before = await planHiringSweep();
    expect(before.entities.map((row) => row.id)).toEqual(["ent-rival"]);

    await findBoard({ id: "ent-rival", domain: "rival.com" });

    const after = await planHiringSweep();
    expect(after.entities.map((row) => row.id)).toEqual([]);
    expect(after.targets).toEqual([
      {
        workspaceId: WS,
        entityId: "ent-rival",
        sourceId: "src_hiring_greenhouse",
        platform: "greenhouse",
        watchId: expect.any(String),
        boardUrl: "https://job-boards.greenhouse.io/rival",
      },
    ]);
  });

  it("finds the board on the homepage, inserts one watch, and does not refetch on a second call", async () => {
    const result = await findBoard({ id: "ent-rival", domain: "rival.com" });

    expect(result).toEqual({
      entityId: "ent-rival",
      platform: "greenhouse",
      boardUrl: "https://job-boards.greenhouse.io/rival",
      watched: true,
    });
    expect(calls.filter((url) => url === "https://rival.com/")).toHaveLength(1);
    expect(await listIdentityCache("hiring:rival.com:")).toHaveLength(1);

    const watches = (await listWatches()).results.filter((row) => row.entity_id === "ent-rival");
    expect(watches).toHaveLength(1);
    const [watch] = watches;
    expect(watch).toMatchObject({
      entity_id: "ent-rival",
      source_id: "src_hiring_greenhouse",
      target_key: "https://job-boards.greenhouse.io/rival",
    });

    const cacheBefore = calls.length;
    const again = await findBoard({ id: "ent-rival", domain: "rival.com" });
    expect(again).toEqual(result);
    expect(calls.length).toBe(cacheBefore);
    expect((await listWatches()).results.filter((row) => row.entity_id === "ent-rival")).toHaveLength(1);
  });

  it("returns watched=false for a non-registrable domain without fetching", async () => {
    const before = calls.length;
    const result = await findBoard({ id: "x", domain: "somecreator" });

    expect(result).toEqual({
      entityId: "x",
      platform: "none",
      boardUrl: null,
      watched: false,
    });
    expect(calls.length).toBe(before);
    expect(await listIdentityCache("hiring:somecreator:")).toEqual([]);
    expect((await listWatches()).results).toEqual([]);
  });
});
