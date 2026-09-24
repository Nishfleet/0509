import type { FeedEntry } from "@extractus/feed-extractor";
import { z } from "zod";

import { parseFeedEntries } from "./feed";
import {
	fetchUpstream,
	mentionsResultSchema,
	type MentionsAdapter,
} from "./types";

const GUID = z.union([
	z.string().min(1),
	z.object({ "#text": z.string().min(1) }).transform((g) => g["#text"]),
]);

const nonempty = (value: string | undefined): string | null =>
	value === undefined || value === "" ? null : value;

export const mediumAdapter: MentionsAdapter = async (target) => {
	const url = `https://medium.com/feed/tag/${encodeURIComponent(target.query)}`;
	const response = await fetchUpstream(url);
	const rawBody = await response.text();
	if (!response.ok) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody });
	}
	const entries: (FeedEntry & { guid?: string | null })[] = parseFeedEntries(rawBody, (d) => ({
		guid: GUID.safeParse(d.guid).data ?? null,
	}));
	const items = entries
		.filter(
			(entry): entry is FeedEntry & { guid: string } =>
				typeof entry.guid === "string" && entry.guid.startsWith("https://medium.com/p/"),
		)
		.map((entry) => ({
			dedupKey: entry.guid,
			url: entry.guid,
			title: entry.title ?? "",
			publishedAt: nonempty(entry.published),
		}));
	return mentionsResultSchema.parse({ items, canaryCount: entries.length, rawBody });
};

