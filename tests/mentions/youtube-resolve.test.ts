import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { youtubeAdapter } from "../../workers/sources/mentions/youtube";
import {
	LOST_CHANNEL_REASON,
	channelIdFromHtml,
	channelIdFromUrl,
	isLostYoutubeChannel,
	lostChannelFlag,
	resolveYoutubeChannelId,
	withLostChannel,
	withResolvedChannel,
	youtubeUrlFromIdentity,
} from "../../workers/mentions/youtube-resolve";

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

	it("reads a channel id from a /channel/ URL and from externalId in HTML", () => {
		expect(channelIdFromUrl(`https://www.youtube.com/channel/${CHANNEL_ID}`)).toBe(CHANNEL_ID);
		expect(channelIdFromUrl("https://www.youtube.com/@gymshark")).toBeNull();
		expect(channelIdFromHtml(`<html>"externalId":"${CHANNEL_ID}"</html>`)).toBe(CHANNEL_ID);
		expect(channelIdFromHtml("<html>no channel here</html>")).toBeNull();
	});

	it("resolves a stored channel URL without fetching, and a handle by one page read", async () => {
		const channelIdentity = JSON.stringify({
			socials: [{ platform: "youtube", url: `https://www.youtube.com/channel/${CHANNEL_ID}` }],
		});
		expect(youtubeUrlFromIdentity(channelIdentity)).toContain(CHANNEL_ID);
		const fetchPage = vi.fn(async () => new Response("no"));
		await expect(resolveYoutubeChannelId(channelIdentity, fetchPage)).resolves.toBe(CHANNEL_ID);
		expect(fetchPage).not.toHaveBeenCalled();

		const handleIdentity = JSON.stringify({
			socials: [{ platform: "youtube", url: "https://www.youtube.com/@gymshark" }],
		});
		const pageFetch = vi.fn(
			async () => new Response(`<html>"externalId":"${CHANNEL_ID}"</html>`, { status: 200 }),
		);
		await expect(resolveYoutubeChannelId(handleIdentity, pageFetch)).resolves.toBe(CHANNEL_ID);
		expect(pageFetch).toHaveBeenCalledOnce();
	});

	it("marks a watch degraded once, then clears that flag when a channel id is saved", () => {
		const at = "2026-09-24T23:01:56.000Z";
		const flagged = withLostChannel('{"kept":true}', at);
		expect(JSON.parse(flagged)).toEqual({
			kept: true,
			degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at },
		});
		expect(withLostChannel(flagged, "2026-09-25T00:00:00.000Z")).toBe(flagged);
		expect(lostChannelFlag(flagged)?.reason).toBe(LOST_CHANNEL_REASON);
		const resolved = withResolvedChannel(flagged, CHANNEL_ID);
		expect(JSON.parse(resolved)).toEqual({ kept: true, channelId: CHANNEL_ID });
		expect(lostChannelFlag(resolved)).toBeNull();
	});
});
