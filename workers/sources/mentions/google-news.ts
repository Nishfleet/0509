import { z } from "zod";

import { parseFeedEntries } from "./feed";
import { fetchUpstream, mentionsResultSchema, type MentionsAdapter } from "./types";

const SOURCE = z.object({ "@_url": z.string().min(1) });

const GUID = z.union([
	z.string().min(1),
	z.object({ "#text": z.string().min(1) }).transform((g) => g["#text"]),
]);

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

	const items = entries
		.filter((entry) => typeof entry.link === "string" && entry.link.length > 0)
		.map((entry) => ({
			dedupKey: entry.guid ?? entry.link,
			url: entry.link,
			title: entry.title ?? "",
			publishedAt: entry.published?.length ? entry.published : null,
			publisher:
				entry.sourceUrl && URL.canParse(entry.sourceUrl) ? new URL(entry.sourceUrl).host : null,
		}));

	return mentionsResultSchema.parse({ items, canaryCount: entries.length, rawBody });
};
