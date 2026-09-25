import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readEntityIdentityJson } from "../../../app/lib/data/entity.server";
import { LOST_CHANNEL_REASON } from "../../../app/lib/mentions/youtube-channel";
import type { WatchRow } from "../../../app/lib/data/watch.server";
import { readWatchConfigJson, writeWatchConfigJson } from "../../../app/lib/data/watch.server";
import { sweepTarget } from "../../../workers/mentions/sweep";

const NOW = "2026-09-24T23:01:56.000Z";
const LOST_ID = "UCaaaaaaaaaaaaaaaaaaaaaa";
const LIVE_ID = "UCma7hhYJ3bfEhZgw3xl77ww";
const EMPTY_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Quiet</title></feed>`;

let runs = 0;

async function seed(identityJson: string, configJson: string): Promise<{ watchId: string; watch: WatchRow }> {
  runs += 1;
  const workspaceId = `ws-yt-${String(runs)}`;
  const userId = `user-yt-${String(runs)}`;
  const competitorId = `${workspaceId}-competitor`;
  const watchId = `watch-yt-${String(runs)}`;
  const domain = `brand-${String(runs)}.example`;
  const name = `Brand ${String(runs)}`;
  const sourceId = "src_mentions_youtube";
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?1, ?2, ?2, 1, ?3, ?3)',
    ).bind(userId, `${userId}@example.com`, NOW),
    env.DB.prepare(
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?1, 'Gymshark', ?2, 'UTC', 1, 8, ?3)",
    ).bind(workspaceId, userId, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'self', ?3, 'Gymshark', '{\"description\":\"Gym clothing\"}', ?4)",
    ).bind(`${workspaceId}-self`, workspaceId, `self-${String(runs)}.example`, NOW),
    env.DB.prepare(
      "INSERT INTO entity (id, workspace_id, role, domain, name, identity_json, created_at) VALUES (?1, ?2, 'competitor', ?3, ?4, ?5, ?6)",
    ).bind(competitorId, workspaceId, domain, name, identityJson, NOW),
    env.DB.prepare(
      "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?1, 'youtube.channel_rss', 'mentions', 'youtube', 'youtube.channel_rss', 'rss', 0, '{}') ON CONFLICT (key) DO NOTHING",
    ).bind(sourceId),
    env.DB.prepare(
      "INSERT INTO watch (id, entity_id, source_id, target_key, config_json) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(watchId, competitorId, sourceId, name, configJson),
  ]);
  const watch: WatchRow = {
    watch_id: watchId,
    target_key: name,
    entity_id: competitorId,
    workspace_id: workspaceId,
    role: "competitor",
    name,
    domain,
    source_id: sourceId,
    plugin_key: "youtube.channel_rss",
    reliability: "rss",
    min_interval_seconds: 0,
  };
  return { watchId, watch };
}

interface StubBody {
  status: number;
  body: string;
  type: string;
}

function handlePage(channelId: string): string {
  return `<!DOCTYPE html><html><head><link rel="canonical" href="https://www.youtube.com/channel/${channelId}"></head></html>`;
}

function stubFeeds(pages: Record<string, StubBody> = {}): ReturnType<typeof vi.fn> {
  const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const page = pages[url];
    if (page !== undefined) {
      return new Response(page.body, { status: page.status, headers: { "content-type": page.type } });
    }
    if (url.includes(LOST_ID)) {
      return new Response("<!DOCTYPE html><html>missing</html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes(LIVE_ID)) {
      return new Response(EMPTY_ATOM, { status: 200, headers: { "content-type": "text/xml" } });
    }
    return new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } });
  });
  vi.stubGlobal("fetch", fakeFetch);
  return fakeFetch;
}

async function configOf(watchId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT config_json FROM watch WHERE id = ?1")
    .bind(watchId)
    .first<{ config_json: string }>();
  return row?.config_json ?? "";
}

async function snapshotCount(watchId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshot WHERE watch_id = ?1")
    .bind(watchId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await env.IDENTITY_CACHE.delete("identity:gymshark:youtube-channel");
});

describe("YouTube sweep stale channel", () => {
  it("does not flag a brand that was never resolved and has no channel URL", async () => {
    const { watchId, watch } = await seed('{"description":"no socials"}', "{}");
    stubFeeds();

    const outcome = await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(outcome).toEqual({ items: 0, stored: 0, unjudged: 0 });
    expect(JSON.parse(await configOf(watchId))).toEqual({});
    expect(await snapshotCount(watchId)).toBe(0);
  });

  it("flags a stored channel whose feed is the 404 HTML page and writes no snapshot", async () => {
    const { watchId, watch } = await seed("{}", JSON.stringify({ channelId: LOST_ID }));
    stubFeeds();

    await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(JSON.parse(await configOf(watchId))).toEqual({
      channelId: LOST_ID,
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: NOW },
    });
    expect(await snapshotCount(watchId)).toBe(0);
  });

  it("stores a channel id from the identity URL, then clears the flag when that feed is Atom", async () => {
    const lost = await seed("{}", JSON.stringify({ channelId: LOST_ID }));
    stubFeeds();
    await sweepTarget(
      {
        sourceId: lost.watch.source_id,
        pluginKey: lost.watch.plugin_key,
        query: lost.watch.target_key,
        watches: [lost.watch],
      },
      NOW,
      null,
    );
    expect(JSON.parse(await configOf(lost.watchId)).degraded.reason).toBe(LOST_CHANNEL_REASON);

    const identity = JSON.stringify({
      socials: [{ platform: "youtube", url: `https://www.youtube.com/channel/${LIVE_ID}` }],
    });
    const resolved = await seed(identity, JSON.stringify({ channelId: LOST_ID }));
    const outcome = await sweepTarget(
      {
        sourceId: resolved.watch.source_id,
        pluginKey: resolved.watch.plugin_key,
        query: resolved.watch.target_key,
        watches: [resolved.watch],
      },
      NOW,
      4,
    );

    expect(outcome).toEqual({ items: 0, stored: 0, unjudged: 0 });
    expect(JSON.parse(await configOf(resolved.watchId))).toEqual({
      channelId: LOST_ID,
      pendingChannelId: LIVE_ID,
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: NOW },
    });
    expect(await snapshotCount(resolved.watchId)).toBe(0);

    const confirmed = await sweepTarget(
      {
        sourceId: resolved.watch.source_id,
        pluginKey: resolved.watch.plugin_key,
        query: resolved.watch.target_key,
        watches: [resolved.watch],
      },
      NOW,
      4,
    );

    expect(confirmed).toEqual({ items: 0, stored: 0, unjudged: 0 });
    expect(JSON.parse(await configOf(resolved.watchId))).toEqual({ channelId: LIVE_ID });
    expect(await snapshotCount(resolved.watchId)).toBe(1);
    const snapshot = await env.DB.prepare(
      "SELECT fetched_at, item_count, canary_count FROM snapshot WHERE watch_id = ?1",
    )
      .bind(resolved.watchId)
      .first<{ fetched_at: string; item_count: number; canary_count: number | null }>();
    expect(snapshot).toEqual({ fetched_at: NOW, item_count: 0, canary_count: 4 });
  });

  it("re-resolves a stale channel from one handle page when that atom feed is 200", async () => {
    const identity = JSON.stringify({
      socials: [{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }],
    });
    const { watchId, watch } = await seed(identity, JSON.stringify({ channelId: LOST_ID }));
    const fakeFetch = stubFeeds({
      "https://www.youtube.com/@gymshark": {
        status: 200,
        body: handlePage(LIVE_ID),
        type: "text/html",
      },
    });

    const outcome = await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(outcome).toEqual({ items: 0, stored: 0, unjudged: 0 });
    expect(JSON.parse(await configOf(watchId))).toEqual({
      channelId: LOST_ID,
      pendingChannelId: LIVE_ID,
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: NOW },
    });
    expect(await snapshotCount(watchId)).toBe(0);
    expect(fakeFetch.mock.calls.map((call) => String(call[0]))).toEqual([
      `https://www.youtube.com/feeds/videos.xml?channel_id=${LOST_ID}`,
      "https://www.youtube.com/@gymshark",
    ]);

    fakeFetch.mockClear();
    const confirmed = await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(confirmed).toEqual({ items: 0, stored: 0, unjudged: 0 });
    expect(JSON.parse(await configOf(watchId))).toEqual({ channelId: LIVE_ID });
    expect(await snapshotCount(watchId)).toBe(1);
    expect(fakeFetch.mock.calls.map((call) => String(call[0]))).toEqual([
      `https://www.youtube.com/feeds/videos.xml?channel_id=${LIVE_ID}`,
    ]);
  });

  it("does not keep a page channel id whose atom feed is not 200", async () => {
    const dead = "UCbbbbbbbbbbbbbbbbbbbbbb";
    const identity = JSON.stringify({
      socials: [{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }],
    });
    const { watchId, watch } = await seed(identity, JSON.stringify({ channelId: LOST_ID }));
    stubFeeds({
      "https://www.youtube.com/@gymshark": { status: 200, body: handlePage(dead), type: "text/html" },
      [`https://www.youtube.com/feeds/videos.xml?channel_id=${dead}`]: {
        status: 404,
        body: "<!DOCTYPE html><html>missing</html>",
        type: "text/html",
      },
    });

    await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(JSON.parse(await configOf(watchId))).toEqual({
      channelId: LOST_ID,
      pendingChannelId: dead,
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: NOW },
    });
    expect(await snapshotCount(watchId)).toBe(0);

    await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(JSON.parse(await configOf(watchId))).toEqual({
      channelId: LOST_ID,
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: NOW },
    });
    expect(await snapshotCount(watchId)).toBe(0);
  });

  it("stores a channel id found on a handle page when the atom feed is 200", async () => {
    const identity = JSON.stringify({
      socials: [{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }],
    });
    const { watchId, watch } = await seed(identity, "{}");
    stubFeeds({
      "https://www.youtube.com/@gymshark": { status: 200, body: handlePage(LIVE_ID), type: "text/html" },
    });

    const outcome = await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      4,
    );

    expect(outcome).toEqual({ items: 0, stored: 0, unjudged: 0 });
    expect(JSON.parse(await configOf(watchId))).toEqual({ channelId: LIVE_ID });
    expect(await snapshotCount(watchId)).toBe(1);
  });

  it("flags a handle whose page fetch fails instead of reading as zero videos", async () => {
    const identity = JSON.stringify({
      socials: [{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }],
    });
    const { watchId, watch } = await seed(identity, "{}");
    stubFeeds({
      "https://www.youtube.com/@gymshark": {
        status: 404,
        body: "<!DOCTYPE html><html>missing</html>",
        type: "text/html",
      },
    });

    const outcome = await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(outcome).toEqual({ items: 0, stored: 0, unjudged: 0 });
    expect(JSON.parse(await configOf(watchId))).toEqual({
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: NOW },
    });
    expect(await snapshotCount(watchId)).toBe(0);
  });

  it("leaves the watch unmarked when the feed fails with 503", async () => {
    const { watchId, watch } = await seed("{}", JSON.stringify({ channelId: "UCzzzzzzzzzzzzzzzzzzzzzz" }));
    stubFeeds();

    await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(JSON.parse(await configOf(watchId))).toEqual({ channelId: "UCzzzzzzzzzzzzzzzzzzzzzz" });
    expect(await snapshotCount(watchId)).toBe(0);
  });

  it("fails when the watch or entity row is missing instead of pretending the config is empty", async () => {
    expect(await readWatchConfigJson("watch-missing")).toBeNull();
    expect(await readEntityIdentityJson("entity-missing")).toBeNull();
    await expect(writeWatchConfigJson("watch-missing", "{}")).rejects.toThrow(/watch-missing was not updated/);

    const { watch } = await seed('{"description":"no socials"}', "{}");
    stubFeeds();
    const target = {
      sourceId: watch.source_id,
      pluginKey: watch.plugin_key,
      query: watch.target_key,
      watches: [watch],
    };
    await expect(
      sweepTarget({ ...target, watches: [{ ...watch, watch_id: "watch-missing" }] }, NOW, null),
    ).rejects.toThrow(/watch-missing is missing/);
    await expect(
      sweepTarget({ ...target, watches: [{ ...watch, entity_id: "entity-missing" }] }, NOW, null),
    ).rejects.toThrow(/entity-missing is missing/);
    expect(JSON.parse(await configOf(watch.watch_id))).toEqual({});
    expect(await snapshotCount(watch.watch_id)).toBe(0);
  });

  it("rethrows a lookup error that is not a missed page and does not mark the watch lost", async () => {
    const identity = JSON.stringify({
      socials: [{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }],
    });
    const { watchId, watch } = await seed(identity, "{}");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("lookup failed");
      }),
    );

    await expect(
      sweepTarget(
        { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
        NOW,
        null,
      ),
    ).rejects.toThrow(/lookup failed/);
    expect(JSON.parse(await configOf(watchId))).toEqual({});
    expect(await snapshotCount(watchId)).toBe(0);
  });

  it("flags a handle page that fails as a network error and writes no snapshot", async () => {
    const identity = JSON.stringify({
      socials: [{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }],
    });
    const { watchId, watch } = await seed(identity, "{}");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    const outcome = await sweepTarget(
      { sourceId: watch.source_id, pluginKey: watch.plugin_key, query: watch.target_key, watches: [watch] },
      NOW,
      null,
    );

    expect(outcome).toEqual({ items: 0, stored: 0, unjudged: 0 });
    expect(JSON.parse(await configOf(watchId))).toEqual({
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: NOW },
    });
    expect(await snapshotCount(watchId)).toBe(0);
  });
});
