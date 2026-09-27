import { parseFeedEntries } from "./feed";
import {
	fetchUpstream,
	mentionsResultSchema,
	type MentionsAdapter,
	type MentionsResult,
} from "./types";

export function parseReddit(rawBody: string): MentionsResult {
	const entries = parseFeedEntries(rawBody);
	const posts = entries.filter(
		(entry) => typeof entry.id === "string" && entry.id.startsWith("t3_"),
	);
	const items = posts.map((entry) => {
		const upstreamUrl = entry.link ?? "";
		return {
			dedupKey: entry.id,
			url:
				upstreamUrl.length > 0
					? upstreamUrl
					: "https://www.reddit.com/comments/" + entry.id.slice(3),
			title: entry.title ?? "",
			publishedAt: entry.published ?? null,
		};
	});
	const ordered = [...items].sort((a, b) => {
		const timeA = Date.parse(a.publishedAt ?? "");
		const timeB = Date.parse(b.publishedAt ?? "");
		if (Number.isNaN(timeA)) return Number.isNaN(timeB) ? 0 : 1;
		if (Number.isNaN(timeB)) return -1;
		return timeB - timeA;
	});
	return mentionsResultSchema.parse({
		items: ordered,
		canaryCount: entries.length,
		rawBody,
	});
}

export const redditAdapter: MentionsAdapter = async (target, _cursor) => {
	const url =
		"https://www.reddit.com/search.rss?q=" +
		encodeURIComponent(target.query) +
		"&sort=new";
	const response = await fetchUpstream(url);
	if (!response.ok) {
		throw new Error("reddit.search_rss " + String(response.status));
	}
	return parseReddit(await response.text());
};
