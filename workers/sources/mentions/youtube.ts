import type { FeedEntry } from "@extractus/feed-extractor";
import { z } from "zod";

import { isYoutubeChannelId } from "../../../app/lib/mentions/youtube-channel";
import { parseFeedEntries } from "./feed";
import {
	fetchUpstream,
	mentionsResultSchema,
	type MentionsAdapter,
} from "./types";

const ATOM_NS = "http://www.w3.org/2005/Atom";
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

type AtomEntry = FeedEntry & { videoId: string | null };

function atomEntries(xml: string): AtomEntry[] | null {
	try {
		return parseFeedEntries(xml, (data) => ({
			videoId: VIDEO_ID.safeParse(data["yt:videoId"] ?? data.videoId).data ?? null,
		}));
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		if (error.message === "Unrecognized feed format" && xml.includes(ATOM_NS)) return [];
		if (
			error.message === "The XML document is not well-formed" ||
			error.message === "Unrecognized feed format"
		) {
			return null;
		}
		throw error;
	}
}

export const youtubeAdapter: MentionsAdapter = async (target) => {
	if (!isYoutubeChannelId(target.query)) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody: "", feedState: "error" });
	}
	const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(target.query)}`;
	const response = await fetchUpstream(url);
	const rawBody = await response.text();

	if (response.status === 404) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody, feedState: "stale" });
	}
	if (!response.ok) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody, feedState: "error" });
	}

	const entries = atomEntries(rawBody);
	if (entries === null) {
		return mentionsResultSchema.parse({ items: [], canaryCount: 0, rawBody, feedState: "stale" });
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
