import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { youtubeAdapter } from "../../workers/sources/mentions/youtube";

const CHANNEL_ID = "UCma7hhYJ3bfEhZgw3xl77ww";
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const FIXTURE_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	`../fixtures/mentions/youtube-2026-09-24.xml`,
);

function liveFixture(): string {
	return readFileSync(FIXTURE_PATH, "utf8");
}

function stubFetchWith(body: string, init: ResponseInit = { status: 200 }): ReturnType<typeof vi.fn> {
	const fakeFetch = vi.fn(async () => new Response(body, init));
	vi.stubGlobal("fetch", fakeFetch);
	return fakeFetch;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("youtubeAdapter", () => {
	it("calls fetch once with the channel-feed URL", async () => {
		const fakeFetch = stubFetchWith(liveFixture());

		await youtubeAdapter({ query: CHANNEL_ID }, null);

		expect(fakeFetch).toHaveBeenCalledTimes(1);
		const firstArg = fakeFetch.mock.calls[0]?.[0];
		expect(firstArg).toBe(FEED_URL);
	});

	it("returns items whose dedupKey is the video id and whose url is the watch URL", async () => {
		stubFetchWith(liveFixture());

		const result = await youtubeAdapter({ query: CHANNEL_ID }, null);

		expect(result.items.length).toBeGreaterThan(0);
		for (const item of result.items) {
			expect(item.dedupKey).toMatch(/^[A-Za-z0-9_-]{11}$/);
			expect(item.url).toBe(`https://www.youtube.com/watch?v=${item.dedupKey}`);
		}
	});

	it("maps an entry with yt:videoId and no published or updated to publishedAt null", async () => {
		const body = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
 <title>Gymshark</title>
 <id>yt:channel:${CHANNEL_ID}</id>
 <entry>
  <id>yt:video:QVx0PY1lf-s</id>
  <yt:videoId>QVx0PY1lf-s</yt:videoId>
  <title>GYMSHARK ONYX V1 RETURNS</title>
 </entry>
</feed>`;
		stubFetchWith(body);

		const result = await youtubeAdapter({ query: CHANNEL_ID }, null);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.dedupKey).toBe("QVx0PY1lf-s");
		expect(result.items[0]?.url).toBe("https://www.youtube.com/watch?v=QVx0PY1lf-s");
		expect(result.items[0]?.publishedAt).toBeNull();
	});

	it("returns an empty result with canaryCount 0 when the response is 404", async () => {
		stubFetchWith("x", { status: 404 });

		const result = await youtubeAdapter({ query: CHANNEL_ID }, null);

		expect(result.items).toEqual([]);
		expect(result.canaryCount).toBe(0);
		expect(result.feedState).toBe("stale");
	});

	it("does not fetch when the query is a brand name rather than a channel id", async () => {
		const fakeFetch = stubFetchWith("x", { status: 404 });

		const result = await youtubeAdapter({ query: "Gymshark" }, null);

		expect(fakeFetch).not.toHaveBeenCalled();
		expect(result.feedState).toBe("error");
		expect(result.items).toEqual([]);
	});

	it("reports a 503 as an error so the sweep does not store zero videos", async () => {
		stubFetchWith("unavailable", { status: 503, headers: { "content-type": "text/html" } });

		const result = await youtubeAdapter({ query: CHANNEL_ID }, null);

		expect(result.feedState).toBe("error");
		expect(result.items).toEqual([]);
		expect(result.canaryCount).toBe(0);
	});

	it("keeps a 200 Atom feed with no entries as an empty result, not stale", async () => {
		const body = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
 <title>Quiet</title>
</feed>`;
		stubFetchWith(body, { status: 200, headers: { "content-type": "text/xml" } });

		const result = await youtubeAdapter({ query: CHANNEL_ID }, null);

		expect(result.feedState).toBe("ok");
		expect(result.items).toEqual([]);
		expect(result.canaryCount).toBe(0);
	});
});
