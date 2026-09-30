import { env, introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PAD =
  "Every plan includes unlimited projects, priority support, single sign-on, audit logs, and a named account manager who answers within one business day, with onboarding help for your whole team.";

const USER = "user-hiring-sweep";
const WS = "ws-hiring-sweep";
const NOW = "2026-09-24T02:00:00Z";
const LISTING_URL = "https://boards-api.greenhouse.io/v1/boards/rival/jobs";

const HOMEPAGE_HTML = `<!doctype html><html><body><h1>Rival</h1><p>${PAD}</p><footer><a href="https://job-boards.greenhouse.io/rival">Careers</a></footer></body></html>`;

const job = (id: number, title: string) => ({
  id,
  title,
  absolute_url: `https://job-boards.greenhouse.io/rival/jobs/${id}`,
  location: { name: "Remote" },
  first_published: "2026-09-20T00:00:00.000Z",
});

const NIGHT_ONE = { jobs: [job(101, "Platform Engineer"), job(102, "Product Designer")] };
const NIGHT_TWO = { jobs: [...NIGHT_ONE.jobs, job(103, "Data Scientist")] };

const listing = { body: JSON.stringify(NIGHT_ONE) };
const calls: string[] = [];

const seedEntity = (id: string, domain: string, state: "on" | "off") =>
  env.DB.prepare(
    `INSERT INTO entity (id, workspace_id, role, domain, identity_json, origin, state, created_at)
     VALUES (?, ?, 'competitor', ?, '{}', 'manual', ?, ?)`,
  )
    .bind(id, WS, domain, state, NOW)
    .run();

const hiringSignals = async () => {
  const { results } = await env.DB.prepare(
    "SELECT kind, title, entity_id FROM signal WHERE workspace_id = ?1 AND kind = 'hiring'",
  )
    .bind(WS)
    .all<{ kind: string; title: string | null; entity_id: string }>();
  return results;
};

const runSweep = async (id: string) => {
  await using introspector = await introspectWorkflowInstance(env.HIRING_SWEEP, id);
  await env.HIRING_SWEEP.create({ id });
  await introspector.waitForStatus("complete");
  return introspector.getOutput();
};

describe("nightly hiring sweep workflow", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM signal");
    await env.DB.exec("DELETE FROM snapshot");
    await env.DB.exec("DELETE FROM watch");
    await env.DB.exec("DELETE FROM entity");
    await env.DB.exec("DELETE FROM workspace");
    await env.DB.exec('DELETE FROM "user"');
    const stored = await env.SNAPSHOTS.list({ prefix: "snapshot/hiring/" });
    await Promise.all(stored.objects.map((object) => env.SNAPSHOTS.delete(object.key)));
    const cached = await env.IDENTITY_CACHE.list({ prefix: "hiring:" });
    await Promise.all(cached.keys.map((key) => env.IDENTITY_CACHE.delete(key.name)));

    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'hiring-sweep@0509.io', 1, ?, ?)`,
    )
      .bind(USER, NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Hiring Sweep', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WS, USER, NOW)
      .run();
    await seedEntity("ent-rival", "rival.com", "on");
    await seedEntity("ent-paused", "paused.com", "off");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json)
       VALUES ('src_hiring_greenhouse', 'hiring.greenhouse', 'hiring', 'greenhouse', 'hiring.board', 'official_api', 1, '{}')`,
    ).run();
    await env.DB.prepare("UPDATE source SET is_enabled = 1 WHERE id = 'src_hiring_greenhouse'").run();

    listing.body = JSON.stringify(NIGHT_ONE);
    calls.length = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url === "https://rival.com/") {
        return Promise.resolve(new Response(HOMEPAGE_HTML, { status: 200 }));
      }
      if (url === LISTING_URL) {
        return Promise.resolve(
          new Response(listing.body, {
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

  it("discovers the rival's board, baselines it, and files no signals on the first night", async () => {
    const output = await runSweep("hiring-night-1");

    expect(output).toMatchObject({
      discovered: 1,
      boards: 1,
      first: 1,
      newRoles: 0,
      failed: 0,
    });
    expect(await hiringSignals()).toEqual([]);
    expect(calls.filter((url) => url.includes("paused.com"))).toEqual([]);
  });

  it("files exactly one hiring signal the night a new role appears, and never touches the paused entity", async () => {
    await runSweep("hiring-night-1");

    listing.body = JSON.stringify(NIGHT_TWO);
    const output = await runSweep("hiring-night-2");

    expect(output).toMatchObject({ changed: 1, newRoles: 1, discovered: 0 });
    const signals = await hiringSignals();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "hiring", entity_id: "ent-rival", title: "Data Scientist" });
    expect(calls.filter((url) => url.includes("paused.com"))).toEqual([]);
  });
});
