import { z } from "zod";

import { parseFeedEntries } from "./feed";
import {
	fetchUpstream,
	mentionsResultSchema,
	type MentionsAdapter,
} from "./types";

const VIDEO_ID = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

export const youtubeAdapter: MentionsAdapter = async (target) => {
	const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(target.query)}`;
	const response = await fetchUpstream(url);
	const rawBody = await response.text();

	if (!response.ok) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody });
	}

	const entries = parseFeedEntries(rawBody, (data) => ({
		videoId: VIDEO_ID.safeParse(data["yt:videoId"] ?? data["videoId"]).data ?? null,
	}));

	const items = entries
		.filter((entry) => entry.videoId !== null && entry.videoId !== undefined)
		.map((entry) => ({
			dedupKey: entry.videoId as string,
			url: `https://www.youtube.com/watch?v=${entry.videoId}`,
			title: entry.title ?? "",
			publishedAt: entry.published ? entry.published : null,
		}));

	return mentionsResultSchema.parse({ items, canaryCount: entries.length, rawBody });
};
