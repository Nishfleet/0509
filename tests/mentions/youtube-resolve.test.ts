import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  LOST_CHANNEL_REASON,
  NO_CHANNEL_REASON,
  channelIdFromHtml,
  channelIdFromIdentity,
  channelIdFromUrl,
  readWatchConfig,
  withLostChannel,
  withNoChannel,
  withPageMiss,
  withPendingChannel,
  withFeedError,
  withResolvedChannel,
  withoutLostChannel,
  withoutNoChannel,
  withoutPendingChannel,
  youtubeUrlFromIdentity,
} from "../../app/lib/mentions/youtube-channel";
import { youtubeAdapter } from "../../workers/sources/mentions/youtube";

const CHANNEL_ID = "UCma7hhYJ3bfEhZgw3xl77ww";
const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/mentions/youtube-stale-404.html");

function staleFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

describe("stale YouTube channel", () => {
  it("treats the committed HTML fixture as stale on 404 and on 200, and a 500 as an error", async () => {
    const body = staleFixture();
    expect(body).toContain("<!DOCTYPE html>");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })),
    );
    const html = await youtubeAdapter({ query: CHANNEL_ID }, null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 500, headers: { "content-type": "text/html" } })),
    );
    const server = await youtubeAdapter({ query: CHANNEL_ID }, null);
    vi.unstubAllGlobals();
    expect(html.feedState).toBe("stale");
    expect(html.items).toEqual([]);
    expect(server.feedState).toBe("error");
    expect(server.items).toEqual([]);
  });

  it("the adapter reports the fixture as stale and does not invent items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(staleFixture(), { status: 404, headers: { "content-type": "text/html" } })),
    );
    const result = await youtubeAdapter({ query: CHANNEL_ID }, null);
    vi.unstubAllGlobals();
    expect(result.feedState).toBe("stale");
    expect(result.items).toEqual([]);
    expect(result.rawBody).toContain("<!DOCTYPE html>");
  });

  it("reports a 5xx feed as an error, not a quiet channel and not a lost one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } })),
    );
    const result = await youtubeAdapter({ query: CHANNEL_ID }, null);
    vi.unstubAllGlobals();
    expect(result.feedState).toBe("error");
    expect(result.items).toEqual([]);
  });

  it("reads a channel id from a stored /channel/ URL and not from a handle or another host", () => {
    expect(channelIdFromUrl(`https://www.youtube.com/channel/${CHANNEL_ID}`)).toBe(CHANNEL_ID);
    expect(channelIdFromUrl("https://www.youtube.com/@gymshark")).toBeNull();
    expect(channelIdFromUrl(`https://evil.com/channel/${CHANNEL_ID}`)).toBeNull();
    const channelIdentity = JSON.stringify({
      socials: [{ platform: "youtube", url: `https://www.youtube.com/channel/${CHANNEL_ID}` }],
    });
    expect(youtubeUrlFromIdentity(channelIdentity)).toContain(CHANNEL_ID);
    expect(channelIdFromIdentity(channelIdentity)).toBe(CHANNEL_ID);
    const handleIdentity = JSON.stringify({
      socials: [{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }],
    });
    expect(channelIdFromIdentity(handleIdentity)).toBeNull();
    expect(channelIdFromIdentity('{"description":"Gym clothing"}')).toBeNull();
  });

  it("takes a channel id from a handle page, and not from a URL that is not YouTube", () => {
    const html = `<!DOCTYPE html><html><link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}"></html>`;
    expect(channelIdFromHtml(html)).toBe(CHANNEL_ID);
    expect(channelIdFromHtml(`{"externalId":"${CHANNEL_ID}"}`)).toBe(CHANNEL_ID);
    expect(channelIdFromHtml("<!DOCTYPE html><html>no channel</html>")).toBeNull();
    expect(channelIdFromUrl(`https://www.youtube.com/channel/${CHANNEL_ID}`)).toBe(CHANNEL_ID);
    expect(channelIdFromUrl("https://www.youtube.com/@gymshark")).toBeNull();
    expect(channelIdFromUrl(`https://evil.example/watch?v=${CHANNEL_ID}`)).toBeNull();
  });

  it("refuses an unreadable watch config instead of treating it as empty", () => {
    expect(readWatchConfig("{").status).toBe("unreadable");
    expect(readWatchConfig("[1,2]").status).toBe("unreadable");
    expect(readWatchConfig('{"channelId":"not-a-channel"}').status).toBe("unreadable");
    expect(() => withLostChannel("{", "2026-09-24T23:01:56.000Z")).toThrow(/unreadable/);
  });

  it("marks a watch no-channel once, throws on an unreadable config, and clears it when a channel id is saved", () => {
    const at = "2026-09-24T23:01:56.000Z";
    const flagged = withNoChannel('{"kept":true}', at);
    expect(JSON.parse(flagged)).toEqual({
      kept: true,
      noChannel: { state: "degraded", reason: NO_CHANNEL_REASON, at },
    });
    expect(withNoChannel(flagged, "2026-09-25T00:00:00.000Z")).toBe(flagged);
    const flaggedRead = readWatchConfig(flagged);
    expect(flaggedRead.status).toBe("ok");
    if (flaggedRead.status === "ok") expect(flaggedRead.degraded?.reason).toBe(NO_CHANNEL_REASON);
    expect(() => withNoChannel("{", at)).toThrow(/unreadable/);
    const resolved = withResolvedChannel(flagged, CHANNEL_ID);
    expect(JSON.parse(resolved)).toEqual({ kept: true, channelId: CHANNEL_ID });
    const resolvedRead = readWatchConfig(resolved);
    expect(resolvedRead.status).toBe("ok");
    if (resolvedRead.status === "ok") expect(resolvedRead.degraded).toBeNull();
  });

  it("keeps one flag slot per reason, so a stale reason is replaced by the reason true now in both directions", () => {
    const at = "2026-09-24T23:01:56.000Z";
    const later = "2026-09-25T00:00:00.000Z";
    const noChannel = withNoChannel("{}", at);
    const both = withLostChannel(noChannel, later);
    const bothRead = readWatchConfig(both);
    expect(bothRead.status).toBe("ok");
    if (bothRead.status === "ok") {
      expect(bothRead.noChannel).toEqual({ reason: NO_CHANNEL_REASON, at });
      expect(bothRead.lostChannel).toEqual({ reason: LOST_CHANNEL_REASON, at: later });
      expect(bothRead.degraded?.reason).toBe(LOST_CHANNEL_REASON);
    }
    const lostOnly = withoutNoChannel(both);
    expect(JSON.parse(lostOnly)).toEqual({ degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: later } });
    const noChannelOnly = withoutLostChannel(both);
    expect(JSON.parse(noChannelOnly)).toEqual({ noChannel: { state: "degraded", reason: NO_CHANNEL_REASON, at } });
    expect(JSON.parse(withNoChannel(lostOnly, later))).toEqual({
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: later },
      noChannel: { state: "degraded", reason: NO_CHANNEL_REASON, at: later },
    });
    expect(JSON.parse(withoutNoChannel(noChannel))).toEqual({});
    expect(withoutNoChannel(lostOnly)).toBe(lostOnly);
    expect(withoutLostChannel(noChannelOnly)).toBe(noChannelOnly);
    expect(JSON.parse(withResolvedChannel(both, CHANNEL_ID))).toEqual({ channelId: CHANNEL_ID });
  });

  it("reads a no-channel reason stored in the degraded slot by an earlier sweep as the no-channel flag", () => {
    const at = "2026-09-24T23:01:56.000Z";
    const legacy = JSON.stringify({ degraded: { state: "degraded", reason: NO_CHANNEL_REASON, at } });
    const read = readWatchConfig(legacy);
    expect(read.status).toBe("ok");
    if (read.status === "ok") {
      expect(read.noChannel).toEqual({ reason: NO_CHANNEL_REASON, at });
      expect(read.lostChannel).toBeNull();
      expect(read.degraded?.reason).toBe(NO_CHANNEL_REASON);
    }
    expect(JSON.parse(withLostChannel(legacy, "2026-09-25T00:00:00.000Z"))).toEqual({
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at: "2026-09-25T00:00:00.000Z" },
      noChannel: { state: "degraded", reason: NO_CHANNEL_REASON, at },
    });
  });

  it("marks a watch degraded once, then clears that flag when a channel id is saved", () => {
    const at = "2026-09-24T23:01:56.000Z";
    const flagged = withLostChannel('{"kept":true}', at);
    expect(JSON.parse(flagged)).toEqual({
      kept: true,
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at },
    });
    expect(withLostChannel(flagged, "2026-09-25T00:00:00.000Z")).toBe(flagged);
    const flaggedRead = readWatchConfig(flagged);
    expect(flaggedRead.status).toBe("ok");
    if (flaggedRead.status === "ok") expect(flaggedRead.degraded?.reason).toBe(LOST_CHANNEL_REASON);
    const pending = withPendingChannel(flagged, CHANNEL_ID);
    expect(JSON.parse(pending)).toEqual({
      kept: true,
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at },
      pendingChannelId: CHANNEL_ID,
    });
    const dropped = withoutPendingChannel(pending);
    expect(JSON.parse(dropped)).toEqual({
      kept: true,
      degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at },
    });
    const resolved = withResolvedChannel(pending, CHANNEL_ID);
    expect(JSON.parse(resolved)).toEqual({ kept: true, channelId: CHANNEL_ID });
    const resolvedRead = readWatchConfig(resolved);
    expect(resolvedRead.status).toBe("ok");
    if (resolvedRead.status === "ok") expect(resolvedRead.degraded).toBeNull();
  });

  it("keeps the first page-miss record while the reason is unchanged and drops it when the brand has no channel", () => {
    const first = withPageMiss("{}", "youtube page 404", "2026-10-01T19:00:00.000Z");
    expect(withPageMiss(first, "youtube page 404", "2026-10-02T19:00:00.000Z")).toBe(first);
    expect(JSON.parse(withPageMiss(first, "youtube page 503", "2026-10-02T19:00:00.000Z"))).toEqual({
      pageMiss: { reason: "youtube page 503", at: "2026-10-02T19:00:00.000Z" },
    });
    expect(JSON.parse(withNoChannel(first, "2026-10-03T19:00:00.000Z"))).not.toHaveProperty("pageMiss");
  });
});

describe("a failed feed fetch leaves its status and night on the watch", () => {
  it("records the status, keeps the channel and clears when the channel resolves again", () => {
    const base = JSON.stringify({ channelId: CHANNEL_ID });
    const failed = withFeedError(base, 503, "2026-10-10T19:00:03.000Z");

    expect(JSON.parse(failed)).toEqual({
      channelId: CHANNEL_ID,
      feedError: { status: 503, at: "2026-10-10T19:00:03.000Z" },
    });
    expect(readWatchConfig(failed)).toMatchObject({ status: "ok", channelId: CHANNEL_ID, degraded: null });
    expect(JSON.parse(withResolvedChannel(failed, CHANNEL_ID))).toEqual({ channelId: CHANNEL_ID });
  });

  it("drops a stale feed error when the channel is flagged lost", () => {
    const held = JSON.stringify({
      channelId: "UCma7hhYJ3bfEhZgw3xl77ww",
      feedError: { status: 503, at: "2026-10-10T19:00:03.000Z" },
    });
    expect(JSON.parse(withLostChannel(held, "2026-10-11T19:00:00.000Z"))).not.toHaveProperty("feedError");
  });
});
