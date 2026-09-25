import { describe, expect, it, vi } from "vitest";
import { adapterFor } from "../../workers/sources/registry";
import {
	fetchUpstream,
	mentionItemSchema,
	mentionsResultSchema,
	type MentionsAdapter,
	type MentionsCursor,
	type MentionsResult,
	type MentionsTarget,
} from "../../workers/sources/mentions/types";
import { parseFeedEntries } from "../../workers/sources/mentions/feed";

describe("mentions adapter contract", () => {
	it("mentionsResultSchema parses a well-formed result and rejects a negative canaryCount", () => {
		const item = {
			dedupKey: "a",
			url: "https://example.com/a",
			title: "t",
			publishedAt: null,
		};
		const parsed = mentionsResultSchema.parse({
			items: [item],
			canaryCount: 1,
			rawBody: "<x/>",
		});
		expect(parsed.items).toHaveLength(1);
		expect(mentionItemSchema.safeParse(item).success).toBe(true);
		expect(
			mentionsResultSchema.safeParse({ items: [item], canaryCount: -1, rawBody: "<x/>" })
				.success,
		).toBe(false);
	});

	it("mentionItemSchema refuses a javascript: url and accepts an https url", () => {
		expect(
			mentionItemSchema.safeParse({
				dedupKey: "a",
				url: "javascript:alert(1)",
				title: "t",
				publishedAt: null,
			}).success,
		).toBe(false);
		expect(
			mentionItemSchema.safeParse({
				dedupKey: "a",
				url: "https://example.com/a",
				title: "t",
				publishedAt: null,
			}).success,
		).toBe(true);
	});

	it("mentionsResultSchema rejects an item missing dedupKey", () => {
		expect(
			mentionsResultSchema.safeParse({
				items: [{ url: "https://example.com/a", title: "t", publishedAt: null }],
				canaryCount: 1,
				rawBody: "<x/>",
			}).success,
		).toBe(false);
	});

	it("fetchUpstream calls fetch exactly once with the URL and an abort signal", async () => {
		const fetchMock = vi.fn(async () => new Response("ok"));
		vi.stubGlobal("fetch", fetchMock);
		try {
			await fetchUpstream("https://example.com/feed");
		} finally {
			vi.unstubAllGlobals();
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith("https://example.com/feed", {
			signal: expect.any(AbortSignal),
		});
	});

	it("parseFeedEntries reads RSS 2.0 and Atom entries", () => {
		const rss = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<rss version="2.0">',
			"<channel>",
			"<title>Brand mentions</title>",
			"<link>https://example.com</link>",
			"<description>probe</description>",
			"<item><title>First post</title><link>https://example.com/a</link><guid>https://example.com/a#1</guid><pubDate>Wed, 23 Sep 2026 10:00:00 GMT</pubDate></item>",
			"<item><title>Second post</title><link>https://example.com/b</link><guid>https://example.com/b#1</guid><pubDate>Wed, 23 Sep 2026 11:00:00 GMT</pubDate></item>",
			"</channel>",
			"</rss>",
		].join("");
		const entries = parseFeedEntries(rss);
		expect(entries).toHaveLength(2);
		expect(entries[0]?.link).toBe("https://example.com/a");
		expect(entries[1]?.link).toBe("https://example.com/b");

		const atom = [
			'<?xml version="1.0" encoding="utf-8"?>',
			'<feed xmlns="http://www.w3.org/2005/Atom">',
			"<title>Tag feed</title>",
			'<link rel="alternate" href="https://example.com/tag"/>',
			"<id>https://example.com/tag</id>",
			"<updated>2026-09-23T00:00:00Z</updated>",
			"<entry><title>Tagged post</title><link href=\"https://example.com/c\"/><id>https://example.com/c#1</id><updated>2026-09-23T09:00:00Z</updated></entry>",
			"</feed>",
		].join("");
		expect(parseFeedEntries(atom)).toHaveLength(1);
	});

	it("adapterFor returns the feed adapters and undefined for an unknown key", () => {
		expect(adapterFor("news.google_rss")).toBeUndefined();
		expect(adapterFor("youtube.channel_rss")).toBeTypeOf("function");
		expect(adapterFor("medium.tag_rss")).toBeTypeOf("function");
		expect(adapterFor("ddg.html")).toBeUndefined();
		expect(adapterFor("no.such_source")).toBeUndefined();
	});

	it("the adapter contract shape is implementable by a sample adapter", async () => {
		const sample: MentionsAdapter = async (
			target: MentionsTarget,
			cursor: MentionsCursor,
		): Promise<MentionsResult> =>
			mentionsResultSchema.parse({
				items: [],
				canaryCount: 0,
				rawBody: `query=${target.query} cursor=${cursor ?? "none"}`,
			});
		const result = await sample({ query: "gymshark" }, null);
		expect(result.canaryCount).toBe(0);
		expect(result.items).toEqual([]);
	});
});
