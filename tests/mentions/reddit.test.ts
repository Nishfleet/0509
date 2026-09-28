import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseFeedEntries } from "../../workers/sources/mentions/feed";
import { parseReddit, redditAdapter } from "../../workers/sources/mentions/reddit";
import { mentionsResultSchema } from "../../workers/sources/mentions/types";
import { adapterFor } from "../../workers/sources/registry";

const fixture = readFileSync(
	new URL("../fixtures/mentions/reddit-gymshark-2026-09-25.xml", import.meta.url),
	"utf8",
);

describe("reddit.search_rss mentions adapter", () => {
	it("parses the live fixture into post mentions and counts the dropped subreddit entries", () => {
		const parsed = mentionsResultSchema.parse(parseReddit(fixture));
		expect(parsed.items.length).toBeGreaterThan(0);
		expect(parsed.items.every((item) => item.dedupKey.startsWith("t3_"))).toBe(
			true,
		);
		const entries = parseFeedEntries(fixture);
		expect(parsed.canaryCount).toBe(entries.length);
		const subreddits = entries.filter((entry) =>
			entry.id.startsWith("t5_"),
		).length;
		expect(parsed.canaryCount - parsed.items.length).toBe(subreddits);
	});

	it("orders the parsed posts newest first", () => {
		const published = parseReddit(fixture)
			.items.map((item) => item.publishedAt)
			.filter((value): value is string => typeof value === "string");
		expect(published).toEqual(
			[...published].sort((a, b) => Date.parse(b) - Date.parse(a)),
		);
	});

	it("sorts an out-of-order feed newest first with invalid dates last", () => {
		const atom = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<feed xmlns="http://www.w3.org/2005/Atom">',
			"<title>Search</title>",
			'<entry><id>t3_old</id><title>Oldest</title><link href="https://www.reddit.com/comments/old"/><published>2026-09-20T00:00:00Z</published><updated>2026-09-20T00:00:00Z</updated></entry>',
			'<entry><id>t3_new</id><title>Newest</title><link href="https://www.reddit.com/comments/new"/><published>2026-09-24T00:00:00Z</published><updated>2026-09-24T00:00:00Z</updated></entry>',
			'<entry><id>t3_mid</id><title>Middle</title><link href="https://www.reddit.com/comments/mid"/><published>2026-09-22T00:00:00Z</published><updated>2026-09-22T00:00:00Z</updated></entry>',
			'<entry><id>t3_none</id><title>Undated</title><link href="https://www.reddit.com/comments/none"/></entry>',
			"</feed>",
		].join("");
		const parsed = mentionsResultSchema.parse(parseReddit(atom));
		expect(parsed.items.map((item) => item.title)).toEqual([
			"Newest",
			"Middle",
			"Oldest",
			"Undated",
		]);
	});

	it("adapterFor returns the Reddit and HN adapters and the reddit adapter fetches the search URL once", async () => {
		const fetchMock = vi.fn(async () => new Response(fixture));
		vi.stubGlobal("fetch", fetchMock);
		try {
			const adapter = adapterFor("reddit.search_rss");
			expect(adapter).toBeDefined();
			expect(adapter).toBe(redditAdapter);
			expect(adapterFor("hn.algolia")).toBeDefined();
			const result = await adapter?.({ query: "gymshark" }, null);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
				"search.rss?q=gymshark&sort=new",
			);
			expect(result?.items).toEqual(parseReddit(fixture).items);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("rejects an unsuccessful Reddit response", async () => {
		const fetchMock = vi.fn(async () => new Response("", { status: 429 }));
		vi.stubGlobal("fetch", fetchMock);
		try {
			await expect(redditAdapter({ query: "gymshark" }, null)).rejects.toThrow();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
