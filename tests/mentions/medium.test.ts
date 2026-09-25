import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { mediumAdapter } from "../../workers/sources/mentions/medium";

const MEDIUM_GUID_PATTERN = /^https:\/\/medium\.com\/p\/[0-9a-f]+$/;

const FIXTURE = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "../fixtures/mentions/medium-2026-09-24.xml"),
	"utf8",
);

function rssResponse(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "application/rss+xml" },
	});
}

describe("mediumAdapter", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("calls fetch once with the tag-feed URL", async () => {
		const fetchMock = vi.fn(async () => rssResponse(FIXTURE));
		vi.stubGlobal("fetch", fetchMock);

		await mediumAdapter({ query: "gymshark" }, null);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://medium.com/feed/tag/gymshark");
		expect(fetchMock.mock.calls[0]?.[1]).toEqual({ signal: expect.any(AbortSignal) });
	});

	it("returns one mention per <item>, every url is the guid and never the tracking link", async () => {
		vi.stubGlobal("fetch", async () => rssResponse(FIXTURE));

		const result = await mediumAdapter({ query: "gymshark" }, null);

		expect(result.items.length).toBeGreaterThan(0);
		for (const item of result.items) {
			expect(item.url).toMatch(MEDIUM_GUID_PATTERN);
			expect(item.url).not.toContain("?source=");
			expect(item.dedupKey).toBe(item.url);
		}
		expect(result.canaryCount).toBe(result.items.length);
	});

	it("maps an item without pubDate to publishedAt null", async () => {
		const rss = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<rss version="2.0">',
			"<channel>",
			"<title>Brand mentions</title>",
			"<link>https://example.com</link>",
			"<description>probe</description>",
			"<item><title>Dateless</title><link>https://medium.com/p/dateless?source=rss------x-1</link><guid isPermaLink=\"false\">https://medium.com/p/dateless</guid></item>",
			"</channel>",
			"</rss>",
		].join("");
		vi.stubGlobal("fetch", async () => rssResponse(rss));

		const result = await mediumAdapter({ query: "x" }, null);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.publishedAt).toBeNull();
		expect(result.items[0]?.url).toBe("https://medium.com/p/dateless");
	});

	it("returns an empty items list with canaryCount 0 when the upstream fails", async () => {
		vi.stubGlobal("fetch", async () => new Response("x", { status: 503 }));

		const result = await mediumAdapter({ query: "gymshark" }, null);

		expect(result.items).toEqual([]);
		expect(result.canaryCount).toBe(0);
		expect(result.rawBody).toBe("x");
	});
});
