import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { googleNewsAdapter } from "../../workers/sources/mentions/google-news";

const FIXTURE = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "../fixtures/gnews-gymshark.xml"),
	"utf8",
);

const NO_DATE_RSS = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<rss version="2.0">',
	"<channel>",
	"<title>No pubDate</title>",
	"<link>https://news.google.com/</link>",
	"<description>one item, no date</description>",
	'<item><title>Undated story</title><link>https://news.google.com/rss/articles/CBMiUndated</link><guid isPermaLink="false">CBMiUndated</guid></item>',
	"</channel>",
	"</rss>",
].join("");

describe("googleNewsAdapter", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("requests the Google News RSS search feed once for the quoted query", async () => {
		const fetchMock = vi.fn(async () => new Response(FIXTURE));
		vi.stubGlobal("fetch", fetchMock);

		await googleNewsAdapter({ query: "Gymshark" }, null);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const url = fetchMock.mock.calls[0]?.[0];
		expect(typeof url).toBe("string");
		expect(url).toContain("news.google.com/rss/search");
		expect(url).toContain("q=%22Gymshark%22");
	});

	it("maps every feed item to a mention with the Google url and the source host", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(FIXTURE)),
		);

		const result = await googleNewsAdapter({ query: "Gymshark" }, null);

		expect(result.items.length).toBeGreaterThan(0);
		expect(result.items[0]?.url).toMatch(/^https:\/\/news\.google\.com\/rss\/articles\//);
		expect(result.items[0]?.publisher).toBe("www.theguardian.com");
		expect(result.canaryCount).toBeGreaterThanOrEqual(result.items.length);
	});

	it("leaves publishedAt null when the feed gives no date", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(NO_DATE_RSS)),
		);

		const result = await googleNewsAdapter({ query: "Gymshark" }, null);

		expect(result.items).toHaveLength(1);
		expect(result.items[0]?.publishedAt).toBe(null);
	});

	it("returns an empty result when the feed fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("x", { status: 503 })),
		);

		const result = await googleNewsAdapter({ query: "Gymshark" }, null);

		expect(result.items).toEqual([]);
		expect(result.canaryCount).toBe(0);
	});
});
