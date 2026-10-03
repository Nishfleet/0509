import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { insertWatches, readFeedTargets, readWatchConfigJson } from "../../../app/lib/data/watch.server";
import { readFeed } from "../../../app/lib/feeds/read-feed.server";
import { resetFeedFixtures, rssFeed, seedEntity } from "./seed";

const USER = "user-feed-read";
const WS = "ws-feed-read";
const WATCH_ID = "watch-rival-feed";
const FEED_URL = "https://rival.com/feed";

const nextTick = async (name: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { instanceId: name, plannedAt: new Date().toISOString() };
};

const server = {
  status: 200,
  body: "",
  etag: '"v1"' as string | null,
  robots: "User-agent: *\nAllow: /",
  requests: [] as { url: string; headers: Headers }[],
};

const NIGHT_ONE = [
  { id: "p1", title: "First post" },
  { id: "p2", title: "Second post" },
];
const NIGHT_TWO = [...NIGHT_ONE, { id: "p3", title: "Third post" }];

const target = async () => {
  const found = (await readFeedTargets()).find((row) => row.watchId === WATCH_ID);
  if (found === undefined) throw new Error("expected the rival feed target");
  return found;
};

const signals = async () => {
  const { results } = await env.DB.prepare(
    "SELECT kind, title, summary, url, dedup_key, published_at FROM signal WHERE workspace_id = ?1 ORDER BY title",
  )
    .bind(WS)
    .all<{
      kind: string;
      title: string;
      summary: string | null;
      url: string;
      dedup_key: string;
      published_at: string | null;
    }>();
  return results;
};

const snapshots = async () => {
  const { results } = await env.DB.prepare(
    "SELECT id, payload_r2_key, item_count FROM snapshot WHERE watch_id = ?1 ORDER BY fetched_at",
  )
    .bind(WATCH_ID)
    .all<{ id: string; payload_r2_key: string | null; item_count: number }>();
  return results;
};

describe("readFeed", () => {
  beforeEach(async () => {
    await resetFeedFixtures({ user: USER, workspace: WS, email: "feed-read@0509.io" });
    await seedEntity(WS, "ent-rival", "rival.com");
    const sourceId = (await env.DB.prepare("SELECT id FROM source WHERE key = 'feed.rss'").first<{ id: string }>())?.id;
    await insertWatches([{ id: WATCH_ID, entityId: "ent-rival", sourceId: sourceId ?? "", targetKey: FEED_URL }]);

    server.status = 200;
    server.body = rssFeed(NIGHT_ONE);
    server.etag = '"v1"';
    server.robots = "User-agent: *\nAllow: /";
    server.requests = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      server.requests.push({ url: request.url, headers: request.headers });
      if (request.url === "https://rival.com/robots.txt") return Promise.resolve(new Response(server.robots));
      if (request.url !== FEED_URL) return Promise.resolve(new Response("nope", { status: 404 }));
      if (server.status === 200 && server.etag !== null && request.headers.get("if-none-match") === server.etag) {
        return Promise.resolve(new Response(null, { status: 304 }));
      }
      return Promise.resolve(
        new Response(server.body, {
          status: server.status,
          headers: server.etag === null ? {} : { etag: server.etag },
        }),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("files the first read as the baseline: one snapshot in R2, no signals", async () => {
    const result = await readFeed(await target(), await nextTick("night-1"));

    expect(result).toEqual({ outcome: "first", newPosts: 0 });
    expect(await signals()).toEqual([]);
    const [snapshot] = await snapshots();
    expect(snapshot).toMatchObject({ id: `night-1-${WATCH_ID}`, item_count: 2 });
    expect(snapshot?.payload_r2_key).toBe(`snapshot/feed/${WATCH_ID}/night-1-${WATCH_ID}.json`);
    const stored = await env.SNAPSHOTS.get(snapshot?.payload_r2_key ?? "");
    expect(JSON.parse((await stored?.text()) ?? "[]")).toHaveLength(2);
  });

  it("remembers the ETag and sends it back as a conditional GET, then reads 304 as unchanged", async () => {
    const t = await target();
    await readFeed(t, await nextTick("night-1"));
    expect(JSON.parse((await readWatchConfigJson(WATCH_ID)) ?? "{}")).toEqual({
      feed: { etag: '"v1"', lastModified: null },
    });

    const result = await readFeed(t, await nextTick("night-2"));

    expect(result).toEqual({ outcome: "unchanged", newPosts: 0 });
    const feedRequests = server.requests.filter((request) => request.url === FEED_URL);
    expect(feedRequests[0]?.headers.get("if-none-match")).toBeNull();
    expect(feedRequests[1]?.headers.get("if-none-match")).toBe('"v1"');
    const rows = await snapshots();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: `night-2-${WATCH_ID}`, item_count: 2 });
    expect(rows[1]?.payload_r2_key).toBe(rows[0]?.payload_r2_key);
  });

  it("records a 304 night as a fresh snapshot, so the source never reads as stale", async () => {
    const t = await target();
    await readFeed(t, await nextTick("night-1"));
    await env.DB.prepare(
      "UPDATE source SET latest_fetched_at = '2000-01-01T00:00:00.000Z' WHERE key = 'feed.rss'",
    ).run();

    await readFeed(t, await nextTick("night-2"));

    const row = await env.DB.prepare("SELECT latest_fetched_at AS at FROM source WHERE key = 'feed.rss'").first<{
      at: string;
    }>();
    expect(row?.at.startsWith("2000-")).toBe(false);
  });

  it("keeps the validators next to what else the watch config holds", async () => {
    await env.DB.prepare("UPDATE watch SET config_json = ?2 WHERE id = ?1")
      .bind(WATCH_ID, JSON.stringify({ degraded: { state: "degraded" } }))
      .run();
    await readFeed(await target(), await nextTick("night-1"));
    expect(JSON.parse((await readWatchConfigJson(WATCH_ID)) ?? "{}")).toEqual({
      degraded: { state: "degraded" },
      feed: { etag: '"v1"', lastModified: null },
    });
  });

  it("returns unchanged without a new R2 object when a changed ETag carries the same posts", async () => {
    const t = await target();
    await readFeed(t, await nextTick("night-1"));
    server.etag = '"v2"';
    const result = await readFeed(t, await nextTick("night-2"));

    expect(result).toEqual({ outcome: "unchanged", newPosts: 0 });
    const rows = await snapshots();
    expect(rows).toHaveLength(2);
    expect(rows[1]?.payload_r2_key).toBe(rows[0]?.payload_r2_key);
  });

  it("files one content signal per new post: title, excerpt, link and date, and nothing twice on a re-read", async () => {
    const t = await target();
    await readFeed(t, await nextTick("night-1"));
    server.body = rssFeed(NIGHT_TWO);
    server.etag = '"v2"';
    const changed = await readFeed(t, await nextTick("night-2"));

    expect(changed).toEqual({ outcome: "changed", newPosts: 1 });
    const filed = await signals();
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      kind: "content",
      title: "Third post",
      summary: "About Third post",
      url: "https://rival.com/blog/p3",
      published_at: "2026-09-30T10:00:00.000Z",
    });
    expect(filed[0]?.dedup_key.startsWith(`${WATCH_ID}:`)).toBe(true);

    const again = await readFeed(t, await nextTick("night-3"));
    expect(again).toEqual({ outcome: "unchanged", newPosts: 0 });
    expect(await signals()).toHaveLength(1);
  });

  it("files nothing twice even when the same post is replayed against a stale snapshot", async () => {
    const t = await target();
    await readFeed(t, await nextTick("night-1"));
    server.body = rssFeed(NIGHT_TWO);
    server.etag = '"v2"';
    await readFeed(t, await nextTick("night-2"));
    await env.DB.prepare("DELETE FROM snapshot WHERE id = ?1").bind(`night-2-${WATCH_ID}`).run();
    server.etag = '"v3"';
    await readFeed(t, await nextTick("night-3"));
    expect(await signals()).toHaveLength(1);
  });

  it("treats a feed that a robots.txt rule disallows as unreadable and requests nothing else", async () => {
    server.robots = "User-agent: *\nDisallow: /feed";
    const result = await readFeed(await target(), await nextTick("night-1"));

    expect(result).toEqual({ outcome: "unreadable", newPosts: 0 });
    expect(server.requests.map((request) => request.url)).toEqual(["https://rival.com/robots.txt"]);
    expect(await snapshots()).toEqual([]);
  });

  it("treats an HTML page, an oversize body and a server error as unreadable without throwing", async () => {
    const t = await target();

    server.body = "<!doctype html><html><body>Not a feed</body></html>";
    expect(await readFeed(t, await nextTick("night-1"))).toEqual({ outcome: "unreadable", newPosts: 0 });

    server.body = rssFeed(NIGHT_ONE) + " ".repeat(2 * 1024 * 1024 + 1);
    expect(await readFeed(t, await nextTick("night-2"))).toEqual({ outcome: "unreadable", newPosts: 0 });

    server.status = 503;
    expect(await readFeed(t, await nextTick("night-3"))).toEqual({ outcome: "unreadable", newPosts: 0 });

    expect(await snapshots()).toEqual([]);
    expect(await signals()).toEqual([]);
    const row = await env.DB.prepare("SELECT is_active, last_polled_at FROM watch WHERE id = ?1")
      .bind(WATCH_ID)
      .first<{ is_active: number; last_polled_at: string | null }>();
    expect(row).toEqual({ is_active: 1, last_polled_at: null });
  });

  it("deactivates the watch when the feed is gone", async () => {
    server.status = 404;
    expect(await readFeed(await target(), await nextTick("night-1"))).toEqual({ outcome: "gone", newPosts: 0 });
    const row = await env.DB.prepare("SELECT is_active FROM watch WHERE id = ?1")
      .bind(WATCH_ID)
      .first<{ is_active: number }>();
    expect(row?.is_active).toBe(0);
  });

  it("never writes the feed's text to the log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    server.body = rssFeed([{ id: "secret", title: "Confidential roadmap" }]);
    const t = await target();
    await readFeed(t, await nextTick("night-1"));
    server.body = rssFeed([{ id: "secret2", title: "Confidential pricing" }]);
    server.etag = '"v9"';
    await readFeed(t, await nextTick("night-2"));
    const written = [...log.mock.calls, ...error.mock.calls].flat().join(" ");
    expect(written).not.toContain("Confidential");
    log.mockRestore();
    error.mockRestore();
  });
});
