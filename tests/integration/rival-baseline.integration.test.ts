import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { parseBriefPayload } from "../../app/lib/brief-payload";
import { readRivalFacts } from "../../app/lib/data/rival_baseline.server";
import { rememberRivalDescription } from "../../app/lib/site/rival-profile.server";
import type { SiteSweepTarget } from "../../app/lib/data/watch.server";
import { renderBrief } from "../../workers/delivery/brief-template";
import { composeBrief } from "../../workers/standing/compose-brief";

const CLOSES = new Date("2026-09-21T12:00:00.000Z");
const WEEK = { startsAt: new Date("2026-09-14T12:00:00.000Z"), closesAt: CLOSES };
const SCHEDULE = { timezone: "UTC", weekday: 1, hour: 8 };

async function seedWorkspace(ws: string, rival: string, weeksBefore: number): Promise<void> {
  const at = "2026-09-01T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, 'T', ?2, 1, ?3, ?3)`,
    ).bind(`u-${ws}`, `${ws}@example.test`, at),
    env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, created_at) VALUES (?1, ?1, ?2, 'UTC', ?3)`,
    ).bind(ws, `u-${ws}`, at),
    env.DB.prepare(
      `INSERT INTO source (id, key, kind, platform, plugin_key, reliability) VALUES (?1, ?2, 'site', 'web', ?3, 'scraped_page')`,
    ).bind(`src-${ws}`, `key-${ws}`, `pl-${ws}`),
    env.DB.prepare(
      `INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, state, created_at)
       VALUES (?1, ?2, 'competitor', ?1 || '.example', 'Rival', '{"description":"Lifting gear for everyone"}', 'on', ?3)`,
    ).bind(rival, ws, at),
    env.DB.prepare(
      `INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, reliability) VALUES ('src-site', 'site.web', 'site', 'web', 'site.page', 'scraped_page')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO source (id, key, kind, platform, plugin_key, reliability) VALUES ('src-feed', 'feed.rss', 'site', 'feed', 'feed.rss', 'rss')`,
    ),
    env.DB.prepare(`INSERT INTO watch (id, entity_id, source_id, target_key) VALUES (?1, ?2, 'src-site', 'home')`).bind(
      `w-${ws}`,
      rival,
    ),
    env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, discovered_at) VALUES (?1, ?2, 'https://r.example/', ?3)`,
    ).bind(`pg-${ws}`, rival, at),
    env.DB.prepare(
      `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_hash) VALUES (?1, ?2, ?3, ?4, 'h')`,
    ).bind(`sn-${ws}`, `w-${ws}`, `pg-${ws}`, at),
    env.DB.prepare(
      `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at)
       VALUES (?1, ?2, ?3, '2026-09-14T12:00:00.000Z', 5, 1, NULL, ?4)`,
    ).bind(`st-${ws}`, ws, rival, at),
    ...Array.from({ length: weeksBefore }, (_, index) =>
      env.DB.prepare(
        `INSERT INTO standing (id, workspace_id, entity_id, week_start_at, score, rank, movement, computed_at)
         VALUES (?1, ?2, ?3, ?4, 5, 1, NULL, ?5)`,
      ).bind(`stb-${ws}-${String(index)}`, ws, rival, `2026-08-${String(10 + index)}T12:00:00.000Z`, at),
    ),
  ]);
}

async function signal(input: {
  id: string;
  ws: string;
  entity: string;
  kind: string;
  title: string;
  at: string;
  state?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, dedup_key, observed_at, published_at, canonical_url, url_hash, state)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?1, ?7, ?7, 'https://x.example/' || ?1, ?1, ?8)`,
  )
    .bind(input.id, input.ws, input.entity, `src-${input.ws}`, input.kind, input.title, input.at, input.state ?? null)
    .run();
}

async function compose(ws: string, marks = false) {
  return composeBrief(env.DB, {
    workspaceId: ws,
    schedule: SCHEDULE,
    week: WEEK,
    readThisFirst: { picks: marks ? ["unused"] : [], judged: 0, unjudged: false, unjudgedChanges: false },
  });
}

describe("a rival's starting point in the brief", () => {
  beforeEach(async () => {
    for (const table of ["signal", "snapshot", "page", "watch", "standing", "entity", "source", "workspace"]) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
  });

  it("gives the first brief a baseline from what is already held, and says it is a starting point", async () => {
    await seedWorkspace("ws-a", "rv-a", 0);
    await signal({
      id: "p1",
      ws: "ws-a",
      entity: "rv-a",
      kind: "content",
      title: "Autumn drop",
      at: "2026-09-18T09:00:00.000Z",
    });
    await signal({
      id: "j1",
      ws: "ws-a",
      entity: "rv-a",
      kind: "hiring",
      title: "Designer",
      at: "2026-09-10T09:00:00.000Z",
    });
    await signal({
      id: "old",
      ws: "ws-a",
      entity: "rv-a",
      kind: "mention",
      title: "Ancient",
      at: "2026-06-01T09:00:00.000Z",
    });
    await signal({
      id: "pending",
      ws: "ws-a",
      entity: "rv-a",
      kind: "mention",
      title: "Maybe",
      at: "2026-09-12T09:00:00.000Z",
      state: "unjudged",
    });

    await env.DB.prepare(
      `INSERT INTO page (id, entity_id, url, role, discovered_at) VALUES ('pg-price', 'rv-a', 'https://r.example/pricing', 'pricing', '2026-09-01T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, dedup_key, observed_at, aspect)
       VALUES ('chg', 'ws-a', 'rv-a', 'src-ws-a', 'change', 'Pricing page', 'chg', '2026-09-17T09:00:00.000Z', 'copy')`,
    ).run();
    await env.SNAPSHOTS.put(
      "feed/rv-a.json",
      JSON.stringify([
        { key: "a", title: "Autumn drop", publishedAt: "2026-09-18T09:00:00.000Z" },
        { key: "b", title: "Older post", publishedAt: "2026-08-01T09:00:00.000Z" },
      ]),
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO watch (id, entity_id, source_id, target_key) VALUES ('w-feed', 'rv-a', 'src-feed', 'f')`,
      ),
      env.DB.prepare(
        `INSERT INTO snapshot (id, watch_id, page_id, fetched_at, payload_r2_key, payload_hash, item_count)
         VALUES ('sn-feed', 'w-feed', NULL, '2026-09-19T00:00:00.000Z', 'feed/rv-a.json', 'h', 2)`,
      ),
    ]);

    const payload = await compose("ws-a");
    expect(payload.why_line).toBe(
      "This is your starting point: where your competitor stands today, before anything changes. When one moves, your next brief says so.",
    );
    expect(payload.brands[0]?.baseline).toEqual([
      "In its own words: Lifting gear for everyone",
      "Found on its site: pricing page.",
      "Watched since Sep 1: 1 read, 1 change recorded (last Sep 17).",
      "Blog feed: 2 posts, latest “Autumn drop” (Sep 18). Last 30 days: 1 new post, 1 job post.",
    ]);
    const { text } = renderBrief(parseBriefPayload(JSON.stringify(payload)), {
      unsubscribe_url: "https://0509.io/u/t",
      asset_base_url: "https://assets.0509.io",
    });
    expect(text).toContain("Blog feed: 2 posts, latest “Autumn drop” (Sep 18).");
  });

  it("never reads another workspace's signals into a baseline", async () => {
    await seedWorkspace("ws-a", "rv-a", 0);
    await seedWorkspace("ws-b", "rv-b", 0);
    await signal({
      id: "b1",
      ws: "ws-b",
      entity: "rv-b",
      kind: "content",
      title: "Private to B",
      at: "2026-09-18T09:00:00.000Z",
    });

    const facts = await readRivalFacts(env.DB, "ws-a", CLOSES);
    expect(JSON.stringify([...facts])).not.toContain("Private to B");
    expect([...facts.keys()]).toEqual(["rv-a"]);
  });

  it("keeps the baseline for a quiet week in the first month, and drops it after", async () => {
    await seedWorkspace("ws-a", "rv-a", 1);
    await signal({
      id: "p1",
      ws: "ws-a",
      entity: "rv-a",
      kind: "content",
      title: "Autumn drop",
      at: "2026-09-18T09:00:00.000Z",
    });
    expect((await compose("ws-a")).brands[0]?.baseline).toBeDefined();
    expect((await compose("ws-a")).why_line).toContain("Quiet week");

    await env.DB.exec("DELETE FROM standing");
    await seedWorkspace("ws-c", "rv-c", 4);
    await signal({
      id: "p2",
      ws: "ws-c",
      entity: "rv-c",
      kind: "content",
      title: "Autumn drop",
      at: "2026-09-18T09:00:00.000Z",
    });
    expect((await compose("ws-c")).brands[0]?.baseline).toBeUndefined();
  });

  it("remembers a rival's own description from the home page it already reads, and only the rival's", async () => {
    await seedWorkspace("ws-a", "rv-a", 0);
    await env.DB.prepare(`UPDATE entity SET identity_json = '{}' WHERE id = 'rv-a'`).run();
    const target: SiteSweepTarget = {
      workspaceId: "ws-a",
      entityId: "rv-a",
      entityRole: "competitor",
      sourceId: "src-site",
      watchId: "w-ws-a",
      pageId: "pg-ws-a",
      pageRole: "home",
      url: "https://r.example/",
      transport: null,
      transportTestedAt: null,
    };
    const read = {
      ok: true as const,
      html: '<html><head><meta name="description" content="  Lifting   gear for everyone "></head><body>Hi</body></html>',
      transport: "fetch" as const,
      status: 200,
      ms: 1,
      escalated: false,
    };
    await rememberRivalDescription(target, read);
    await rememberRivalDescription(
      { ...target, pageRole: "pricing" },
      { ...read, html: read.html.replace("Lifting", "Other") },
    );
    const row = await env.DB.prepare(
      `SELECT json_extract(identity_json, '$.description') AS d FROM entity WHERE id = 'rv-a'`,
    ).first();
    expect(row).toEqual({ d: "Lifting gear for everyone" });
    await rememberRivalDescription(
      { ...target, entityRole: "self" },
      { ...read, html: read.html.replace("Lifting", "Own") },
    );
    expect(
      await env.DB.prepare(
        `SELECT json_extract(identity_json, '$.description') AS d FROM entity WHERE id = 'rv-a'`,
      ).first(),
    ).toEqual({
      d: "Lifting gear for everyone",
    });
  });
});
