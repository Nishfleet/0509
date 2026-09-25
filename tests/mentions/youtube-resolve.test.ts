import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
	LOST_CHANNEL_REASON,
	channelIdFromHtml,
	channelIdFromIdentity,
	channelIdFromUrl,
	isLostYoutubeChannel,
	readWatchConfig,
	withLostChannel,
	withPendingChannel,
	withResolvedChannel,
	withoutPendingChannel,
	youtubeUrlFromIdentity,
} from "../../app/lib/mentions/youtube-channel";
import { youtubeAdapter } from "../../workers/sources/mentions/youtube";

const CHANNEL_ID = "UCma7hhYJ3bfEhZgw3xl77ww";
const FIXTURE_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"../fixtures/mentions/youtube-stale-404.html",
);

function staleFixture(): string {
	return readFileSync(FIXTURE_PATH, "utf8");
}

describe("stale YouTube channel", () => {
	it("treats the committed 404 HTML fixture as a lost channel, not an empty feed", () => {
		const body = staleFixture();
		expect(body).toContain("<!DOCTYPE html>");
		expect(isLostYoutubeChannel(404, "text/html; charset=UTF-8", body)).toBe(true);
		expect(isLostYoutubeChannel(200, "text/html", body)).toBe(true);
		expect(isLostYoutubeChannel(200, "text/xml", "<feed></feed>")).toBe(false);
		expect(isLostYoutubeChannel(500, "text/html", body)).toBe(false);
		expect(isLostYoutubeChannel(429, "text/plain", "rate")).toBe(false);
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
});
