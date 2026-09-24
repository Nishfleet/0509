import { z } from "zod";

import { isLostYoutubeChannel, isYoutubeChannelId } from "../../mentions/youtube-resolve";
import { parseFeedEntries } from "./feed";
import {
	fetchUpstream,
	mentionsResultSchema,
	type MentionsAdapter,
} from "./types";

const VIDEO_ID = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

const ENTRY_SCHEMA = z
	.object({
		videoId: VIDEO_ID,
		title: z.string().nullish(),
		published: z.string().nullish(),
	})
	.transform((entry) => ({
		videoId: entry.videoId,
		title: entry.title,
		publishedAt: entry.published && entry.published.length > 0 ? entry.published : null,
	}));

export const youtubeAdapter: MentionsAdapter = async (target) => {
	if (!isYoutubeChannelId(target.query)) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody: "", feedState: "stale" });
	}
	const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(target.query)}`;
	const response = await fetchUpstream(url);
	const rawBody = await response.text();
	const contentType = response.headers.get("content-type") ?? "";

	if (isLostYoutubeChannel(response.status, contentType, rawBody)) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody, feedState: "stale" });
	}

	if (!response.ok) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody, feedState: "ok" });
	}

	let entries: ReturnType<typeof parseFeedEntries>;
	try {
		entries = parseFeedEntries(rawBody, (data) => ({
			videoId: VIDEO_ID.safeParse(data["yt:videoId"] ?? data.videoId).data ?? null,
		}));
	} catch {
		const feedState = rawBody.includes("<feed") ? "ok" : "stale";
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody, feedState });
	}

	const items = entries.flatMap((entry) => {
		const parsed = ENTRY_SCHEMA.safeParse(entry);
		if (!parsed.success) return [];
		return [
			{
				dedupKey: parsed.data.videoId,
				url: `https://www.youtube.com/watch?v=${parsed.data.videoId}`,
				title: parsed.data.title ?? "",
				publishedAt: parsed.data.publishedAt,
			},
		];
	});

	return mentionsResultSchema.parse({ items, canaryCount: entries.length, rawBody, feedState: "ok" });
};
