import { z } from "zod";

import { isYoutubeChannelId } from "../../../app/lib/mentions/youtube-channel";
import { readAtomEntries } from "./feed";
import { fetchUpstream, mentionsResultSchema } from "./types";
import type { MentionItem, MentionsCursor, MentionsTarget } from "./types";

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

export interface OkYoutubeFeed {
	feedState: "ok";
	items: MentionItem[];
	canaryCount: number;
	rawBody: string;
}

interface LostYoutubeFeed {
	feedState: "stale" | "error";
	items: [];
	canaryCount: 0;
	rawBody: string;
}

type YoutubeFeed = OkYoutubeFeed | LostYoutubeFeed;

function lostFeed(feedState: "stale" | "error", rawBody: string): LostYoutubeFeed {
	const parsed = mentionsResultSchema.parse({
		items: [],
		canaryCount: 0,
		rawBody,
		feedState,
	});
	if (feedState === "stale") {
		return { feedState: "stale", items: [], canaryCount: 0, rawBody: parsed.rawBody };
	}
	return { feedState: "error", items: [], canaryCount: 0, rawBody: parsed.rawBody };
}

function okFeed(items: MentionItem[], canaryCount: number, rawBody: string): OkYoutubeFeed {
	const parsed = mentionsResultSchema.parse({
		items,
		canaryCount,
		rawBody,
		feedState: "ok",
	});
	return {
		feedState: "ok",
		items: parsed.items,
		canaryCount: parsed.canaryCount,
		rawBody: parsed.rawBody,
	};
}

export async function youtubeAdapter(
	target: MentionsTarget,
	_cursor: MentionsCursor,
): Promise<YoutubeFeed> {
	if (!isYoutubeChannelId(target.query)) return lostFeed("error", "");
	const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(target.query)}`;
	const response = await fetchUpstream(url);
	const rawBody = await response.text();

	if (response.status === 404) return lostFeed("stale", rawBody);
	if (!response.ok) return lostFeed("error", rawBody);

	const entries = readAtomEntries(rawBody, (data) => ({
		videoId: VIDEO_ID.safeParse(data["yt:videoId"] ?? data.videoId).data ?? null,
	}));
	if (entries === null) return lostFeed("stale", rawBody);

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

	return okFeed(items, entries.length, rawBody);
}
