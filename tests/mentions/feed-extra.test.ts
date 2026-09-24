import { describe, expect, it } from "vitest";
import { parseFeedEntries } from "../../workers/sources/mentions/feed";
import { mentionItemSchema } from "../../workers/sources/mentions/types";

const rss = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<rss version="2.0">',
	"<channel>",
	"<title>Brand mentions</title>",
	"<link>https://example.com</link>",
	"<description>probe</description>",
	"<item><title>First post</title><link>https://example.com/a</link><guid>https://example.com/a#1</guid><pubDate>Wed, 23 Sep 2026 10:00:00 GMT</pubDate><source url=\"https://www.theguardian.com\">The Guardian</source></item>",
	"</channel>",
	"</rss>",
].join("");

describe("parseFeedEntries extra fields", () => {
	it("passes raw per-entry fields to the extra-fields hook", () => {
		const entries = parseFeedEntries(rss, (data) => ({ sourceRaw: data.source }));

		expect(entries[0].sourceRaw["@_url"]).toBe("https://www.theguardian.com");
	});

	it("keeps the no-hook call compatible", () => {
		expect(parseFeedEntries(rss)).toHaveLength(1);
	});

	it("accepts a publisher and keeps it optional", () => {
		const item = {
			dedupKey: "a",
			url: "https://example.com/a",
			title: "t",
			publishedAt: null,
			publisher: "www.ft.com",
		};

		expect(mentionItemSchema.safeParse(item).success).toBe(true);
		const { publisher, ...withoutPublisher } = item;
		void publisher;
		expect(mentionItemSchema.safeParse(withoutPublisher).success).toBe(true);
	});
});
