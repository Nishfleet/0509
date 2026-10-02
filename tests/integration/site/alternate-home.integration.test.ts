import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSiteWatchSummary } from "../../../app/lib/data/watch.server";
import { alternateHomeUrls } from "../../../app/lib/site/alternate-home.server";
import { classifyCompetitorSites } from "../../../app/lib/site/classify-competitors.server";

const NOW = "2026-10-02T02:00:00Z";
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

async function alternatePages(): Promise<
  { url: string; role: string; deferred: string | null; reason: string | null }[]
> {
  const rows = await env.DB.prepare(
    "SELECT url, role, deferred_at, transport_reason FROM page WHERE entity_id = ?1 AND url LIKE 'https://%.rival-shop.com/' ORDER BY url",
  )
    .bind(RIVAL)
    .all<{ url: string; role: string; deferred_at: string | null; transport_reason: string | null }>();
  return rows.results.map((row) => ({
    url: row.url,
    role: row.role,
    deferred: row.deferred_at,
    reason: row.transport_reason,
  }));
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
  it("builds the candidate hosts on the rival's own domain", () => {
    expect(alternateHomeUrls("rival-shop.com")).toEqual([NEWS, NEWSROOM, PRESS]);
  });

  it("watches the first readable alternate and drops the 'couldn't read' note", async () => {
    stubWeb({ [NEWS]: { status: 403, body: "denied" }, [NEWSROOM]: { status: 200, body: NEWS_HTML } });
    await classifyCompetitorSites(NOW);

    const pages = await alternatePages();
    expect(pages.find((page) => page.url === NEWSROOM)).toMatchObject({ role: "blog", deferred: null });
    expect(pages.find((page) => page.url === NEWS)).toMatchObject({ role: "other", reason: "escalation-failed" });
    expect(pages.some((page) => page.url === PRESS)).toBe(false);
    expect(await activeWatches()).toContain(NEWSROOM);
    expect((await readSiteWatchSummary(WS, RIVAL)).unreadable).toBe(false);
  });

  it("does not add a second watch or fetch again once an alternate is watched", async () => {
    stubWeb({ [NEWS]: { status: 200, body: NEWS_HTML } });
    await classifyCompetitorSites(NOW);
    const seen = stubWeb({ [NEWS]: { status: 200, body: NEWS_HTML } });
    await classifyCompetitorSites("2026-10-03T02:00:00Z");
    expect(seen.filter((url) => url.startsWith("https://news"))).toEqual([]);
    expect((await activeWatches()).filter((url) => url.startsWith("https://news"))).toEqual([NEWS]);
  });

  it("keeps the note and tries each blocked alternate once in three days", async () => {
    const seen = stubWeb({
      [NEWS]: { status: 403, body: "x" },
      [NEWSROOM]: "throw",
      [PRESS]: { status: 503, body: "x" },
    });
    await classifyCompetitorSites(NOW);
    expect(await activeWatches()).toEqual([]);
    expect((await readSiteWatchSummary(WS, RIVAL)).unreadable).toBe(true);
    const first = seen.filter((url) => [NEWS, NEWSROOM, PRESS].includes(url)).length;
    expect(first).toBeGreaterThanOrEqual(3);

    await classifyCompetitorSites("2026-10-03T02:00:00Z");
    expect(seen.filter((url) => [NEWS, NEWSROOM, PRESS].includes(url)).length).toBe(first);

    await classifyCompetitorSites("2026-10-06T02:00:00Z");
    expect(seen.filter((url) => [NEWS, NEWSROOM, PRESS].includes(url)).length).toBeGreaterThan(first);
  });

  it("skips a host whose robots.txt disallows us and records why", async () => {
    const seen = stubWeb({
      "https://news.rival-shop.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" },
      [NEWSROOM]: { status: 200, body: NEWS_HTML },
    });
    await classifyCompetitorSites(NOW);
    expect(seen).not.toContain(NEWS);
    expect((await alternatePages()).find((page) => page.url === NEWS)).toMatchObject({
      role: "other",
      reason: "robots",
    });
    expect(await activeWatches()).toContain(NEWSROOM);
  });

  it("leaves a rival whose home page is readable alone", async () => {
    const home = `<html><head><title>Rival</title></head><body><main><p>${"We make training clothes for people who train hard. ".repeat(8)}</p></main></body></html>`;
    const seen = stubWeb({ "https://rival-shop.com/": { status: 200, body: home } });
    await classifyCompetitorSites(NOW);
    expect(seen.some((url) => url.includes("news.") || url.includes("press."))).toBe(false);
    expect(await alternatePages()).toEqual([]);
  });
});
