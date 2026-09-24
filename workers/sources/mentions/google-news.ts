import type { FeedEntry } from "@extractus/feed-extractor";
import { z } from "zod";

import { parseFeedEntries } from "./feed";
import { fetchUpstream, mentionsResultSchema, type MentionsAdapter } from "./types";

const SOURCE = z.object({ "@_url": z.string().min(1) });

const GUID = z.union([
	z.string().min(1),
	z.object({ "#text": z.string().min(1) }).transform((g) => g["#text"]),
]);

interface RawEntry extends FeedEntry {
	sourceUrl?: string | null;
	guid?: string | null;
}

function hasLink(entry: FeedEntry): entry is RawEntry & { link: string } {
	return typeof entry.link === "string" && entry.link.length > 0;
}

function nonEmptyOrNull(value: string | undefined): string | null {
	return value === undefined || value === "" ? null : value;
}

export const googleNewsAdapter: MentionsAdapter = async (target) => {
	const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${target.query}"`)}&hl=en-US&gl=US&ceid=US:en`;
	const response = await fetchUpstream(url);
	const rawBody = await response.text();

	if (!response.ok) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody });
	}

	const entries = parseFeedEntries(rawBody, (d) => ({
		sourceUrl: SOURCE.safeParse(d.source).data?.["@_url"] ?? null,
		guid: GUID.safeParse(d.guid).data ?? null,
	}));

	const items = entries.filter(hasLink).map((entry) => ({
		dedupKey: entry.guid ?? entry.link,
		url: entry.link,
		title: entry.title ?? "",
		publishedAt: nonEmptyOrNull(entry.published),
		publisher:
			entry.sourceUrl !== null && entry.sourceUrl !== undefined && URL.canParse(entry.sourceUrl)
				? new URL(entry.sourceUrl).host
				: null,
	}));

	return mentionsResultSchema.parse({ items, canaryCount: entries.length, rawBody });
};
