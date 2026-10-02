import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSiteWatchSummary } from "../../../app/lib/data/watch.server";
import { alternateHomeUrls } from "../../../app/lib/site/alternate-home.server";
import { classifyCompetitorSites } from "../../../app/lib/site/classify-competitors.server";

const NOW = "2026-10-02T02:00:00Z";
let run = 0;

function on(offsetDays = 0): string {
  return new Date(Date.UTC(2026, 10, 1 + run, 2) + offsetDays * 86_400_000).toISOString();
}
const USER = "user-alt-home";
const WS = "ws-alt-home";
const RIVAL = "ent-alt-home-rival";
const NEWS = "https://news.rival-shop.com/";
const NEWSROOM = "https://newsroom.rival-shop.com/";
const PRESS = "https://press.rival-shop.com/";
const NEWS_HTML = `<html><head><title>Rival news</title></head><body>
<main><p>${"Rival opens a new flagship store and launches its autumn training range. ".repeat(6)}</p></main></body></html>`;

type Answer = { status: number; body: string } | "throw";

function stubWeb(answers: Record<string, Answer>, seen: string[] = []): string[] {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push(url);
    const answer = answers[url];
    if (answer === "throw") return Promise.reject(new TypeError("blocked"));
    return Promise.resolve(
      new Response(answer?.body ?? "", { status: answer?.status ?? 404, headers: { "content-type": "text/html" } }),
    );
  });
  return seen;
}

async function attempts(): Promise<{ url: string; active: number; reason: string | null }[]> {
  const rows = await env.DB.prepare(
    "SELECT target_key, is_active, json_extract(config_json, '$.reason') AS reason FROM watch WHERE entity_id = ?1 AND json_extract(config_json, '$.alternateHome') = 1 ORDER BY target_key",
  )
    .bind(RIVAL)
    .all<{ target_key: string; is_active: number; reason: string | null }>();
  return rows.results.map((row) => ({ url: row.target_key, active: row.is_active, reason: row.reason }));
}

async function activeWatches(): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT target_key FROM watch WHERE entity_id = ?1 AND is_active = 1 ORDER BY target_key",
  )
    .bind(RIVAL)
    .all<{ target_key: string }>();
  return rows.results.map((row) => row.target_key);
}

beforeEach(async () => {
  run += 1;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM watch WHERE entity_id = ?1").bind(RIVAL),
    env.DB.prepare("DELETE FROM page WHERE entity_id = ?1").bind(RIVAL),
    env.DB.prepare("DELETE FROM entity WHERE workspace_id = ?1").bind(WS),
    env.DB.prepare("DELETE FROM workspace WHERE id = ?1").bind(WS),
    env.DB.prepare('DELETE FROM "user" WHERE id = ?1').bind(USER),
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?3, 0, ?4, ?4)',
    ).bind(USER, "Owner", `${USER}@0509.io`, NOW),
    env.DB.prepare("INSERT INTO workspace (id, name, owner_user_id, created_at) VALUES (?1, 'Owner', ?2, ?3)").bind(
      WS,
      USER,
      NOW,
    ),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, origin, state, created_at) VALUES (?1, ?2, 'competitor', 'rival-shop.com', 'Rival', '{}', 'auto', 'on', ?3)",
    ).bind(RIVAL, WS, NOW),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("alternate hosts for a rival whose home page blocks us", () => {
  it("builds the candidate hosts on the rival's registrable domain", () => {
    expect(alternateHomeUrls("rival-shop.com")).toEqual([NEWS, NEWSROOM, PRESS]);
    expect(alternateHomeUrls("www.rival-shop.com")).toEqual([NEWS, NEWSROOM, PRESS]);
  });

  it("is not fooled by an ordinary watched blog page: the note stays and the alternates are still tried", async () => {
    const blog = "https://rival-shop.com/blog";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES ('page-alt-blog', ?1, ?2, 'blog', 'hash', ?3)",
      ).bind(RIVAL, blog, NOW),
      env.DB.prepare(
        "INSERT INTO watch (id, entity_id, source_id, target_key, is_active) VALUES ('watch-alt-blog', ?1, (SELECT id FROM source WHERE key = 'site.web'), ?2, 1)",
      ).bind(RIVAL, blog),
    ]);
    const seen = stubWeb({});
    await classifyCompetitorSites(on());
    expect(seen).toContain(NEWS);
    expect((await readSiteWatchSummary(WS, RIVAL)).unreadable).toBe(true);
  });

  it("does not retry a candidate that already has a judged page, within three days", async () => {
    await env.DB.prepare(
      "INSERT INTO page (id, entity_id, url, role, role_decided_for_hash, discovered_at) VALUES ('page-alt-judged', ?1, ?2, 'blog', 'hash', ?3)",
    )
      .bind(RIVAL, NEWS, NOW)
      .run();
    const seen = stubWeb({ [NEWS]: { status: 403, body: "x" } });
    await classifyCompetitorSites(on());
    const first = seen.filter((url) => url === NEWS).length;
    expect(first).toBeGreaterThanOrEqual(1);
    await classifyCompetitorSites(on(1));
    expect(seen.filter((url) => url === NEWS).length).toBe(first);
  });

  it("watches the first readable alternate and drops the 'couldn't read' note", async () => {
    stubWeb({ [NEWS]: { status: 403, body: "denied" }, [NEWSROOM]: { status: 200, body: NEWS_HTML } });
    await classifyCompetitorSites(on());

    expect(await attempts()).toEqual([
      { url: NEWS, active: 0, reason: "escalation-failed" },
      { url: NEWSROOM, active: 1, reason: null },
    ]);
    const page = await env.DB.prepare("SELECT role, transport FROM page WHERE entity_id = ?1 AND url = ?2")
      .bind(RIVAL, NEWSROOM)
      .first();
    expect(page).toMatchObject({ role: "blog", transport: "fetch" });
    expect(await activeWatches()).toContain(NEWSROOM);
    expect((await readSiteWatchSummary(WS, RIVAL)).unreadable).toBe(false);
  });

  it("does not add a second watch or fetch again once an alternate is watched", async () => {
    stubWeb({ [NEWS]: { status: 200, body: NEWS_HTML } });
    await classifyCompetitorSites(on());
    const seen = stubWeb({ [NEWS]: { status: 200, body: NEWS_HTML } });
    await classifyCompetitorSites(on(1));
    expect(seen.filter((url) => url.startsWith("https://news"))).toEqual([]);
    expect((await activeWatches()).filter((url) => url.startsWith("https://news"))).toEqual([NEWS]);
  });

  it("keeps the note and tries each blocked alternate once in three days", async () => {
    const seen = stubWeb({
      [NEWS]: { status: 403, body: "x" },
      [NEWSROOM]: "throw",
      [PRESS]: { status: 503, body: "x" },
    });
    await classifyCompetitorSites(on());
    expect(await activeWatches()).toEqual([]);
    expect((await readSiteWatchSummary(WS, RIVAL)).unreadable).toBe(true);
    const first = seen.filter((url) => [NEWS, NEWSROOM, PRESS].includes(url)).length;
    expect(first).toBeGreaterThanOrEqual(3);

    await classifyCompetitorSites(on(1));
    expect(seen.filter((url) => [NEWS, NEWSROOM, PRESS].includes(url)).length).toBe(first);

    await classifyCompetitorSites(on(4));
    expect(seen.filter((url) => [NEWS, NEWSROOM, PRESS].includes(url)).length).toBeGreaterThan(first);
  });

  it("skips a host whose robots.txt disallows us and records why", async () => {
    const seen = stubWeb({
      "https://news.rival-shop.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" },
      [NEWSROOM]: { status: 200, body: NEWS_HTML },
    });
    await classifyCompetitorSites(on());
    expect(seen).not.toContain(NEWS);
    expect((await attempts()).find((entry) => entry.url === NEWS)).toMatchObject({ active: 0, reason: "robots" });
    expect(await activeWatches()).toContain(NEWSROOM);
  });

  it("leaves a rival whose home page is readable alone", async () => {
    const home = `<html><head><title>Rival</title></head><body><main><p>${"We make training clothes for people who train hard. ".repeat(8)}</p></main></body></html>`;
    const seen = stubWeb({ "https://rival-shop.com/": { status: 200, body: home } });
    await classifyCompetitorSites(on());
    expect(seen.some((url) => url.includes("news.") || url.includes("press."))).toBe(false);
    expect(await attempts()).toEqual([]);
  });
});
