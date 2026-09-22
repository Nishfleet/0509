import { blankToNull, feedEntries, textOf, viewsFromMedia } from "./feed";
import {
  adapterResultSchema,
  fetchUpstream,
  type MentionItem,
  type MentionTarget,
  UpstreamStatus,
} from "./types";

const PLUGIN_KEY = "youtube.channel_rss";
const CHANNEL_ID = /^UC[\w-]{22}$/;

export function parseYouTube(xml: string): MentionItem[] {
  const items: MentionItem[] = [];
  for (const entry of feedEntries(xml)) {
    const videoId =
      typeof entry.videoId === "string"
        ? entry.videoId
        : typeof entry.id === "string" && entry.id.startsWith("yt:video:")
          ? entry.id.slice("yt:video:".length)
          : null;
    if (!videoId) continue;
    const views = viewsFromMedia(entry.mediaGroup);
    items.push({
      dedupKey: videoId,
      title: entry.title ?? "",
      bodyExcerpt: entry.description ?? "",
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt: blankToNull(entry.published),
      author: textOf(entry.author),
      publisher: "youtube.com",
      engagement: views === null ? {} : { views },
    });
  }
  return items;
}

export async function pollYouTube(target: MentionTarget, _cursor: string | null) {
  const channelId = target.channelId ?? target.query;
  if (!CHANNEL_ID.test(channelId)) {
    throw new UpstreamStatus(PLUGIN_KEY, 404);
  }
  const url = new URL("https://www.youtube.com/feeds/videos.xml");
  url.searchParams.set("channel_id", channelId);
  const { status, body } = await fetchUpstream(url.toString());
  if (status !== 200) throw new UpstreamStatus(PLUGIN_KEY, status);
  const items = parseYouTube(body);
  return adapterResultSchema.parse({ items, canaryCount: items.length, rawBody: body, status });
}
