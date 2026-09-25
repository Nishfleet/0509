import { z } from "zod";

import {
	channelIdFromHtml,
	channelIdFromUrl,
	isYoutubeChannelId,
	youtubeUrlFromIdentity,
} from "../mentions/youtube-channel";
import { normaliseSubject } from "./normalise";
import { cachedProbe } from "./probe-cache.server";

const cachedChannel = z.object({
	channelId: z.string().refine(isYoutubeChannelId),
});

export type YoutubeChannelLookup =
	| { status: "id"; channelId: string }
	| { status: "no-url" }
	| { status: "unresolved" };

export async function lookupYoutubeChannel(identityJson: string): Promise<YoutubeChannelLookup> {
	const url = youtubeUrlFromIdentity(identityJson);
	if (url === null) return { status: "no-url" };
	const fromUrl = channelIdFromUrl(url);
	if (fromUrl !== null) return { status: "id", channelId: fromUrl };
	const normalised = normaliseSubject(url);
	if (!normalised.ok || normalised.subject.platform !== "youtube") return { status: "unresolved" };
	const pageUrl = normalised.subject.url;
	if (!pageUrl?.startsWith("https://www.youtube.com/")) return { status: "unresolved" };
	try {
		const found = await cachedProbe(normalised.subject, "youtube-channel", cachedChannel, async () => {
			const response = await fetch(pageUrl, { signal: AbortSignal.timeout(8_000) });
			if (!response.ok) throw new Error(`youtube page ${String(response.status)}`);
			const id = channelIdFromHtml(await response.text());
			if (id === null) throw new Error("youtube page had no channel id");
			return { channelId: id };
		});
		return { status: "id", channelId: found.channelId };
	} catch (error) {
		if (error instanceof Error) return { status: "unresolved" };
		throw error;
	}
}
