import { parseDdg, pollDdg } from "./mentions/ddg";
import { parseGoogleNews, pollGoogleNews } from "./mentions/google-news";
import { parseHn, pollHn } from "./mentions/hn";
import { parseMedium, pollMedium } from "./mentions/medium";
import { parseReddit, pollReddit } from "./mentions/reddit";
import { type MentionAdapter, type MentionTarget } from "./mentions/types";
import { parseYouTube, pollYouTube } from "./mentions/youtube";

const ADAPTERS: Record<string, MentionAdapter> = {
  "news.google_rss": { pluginKey: "news.google_rss", parse: parseGoogleNews, poll: pollGoogleNews },
  "reddit.search_rss": { pluginKey: "reddit.search_rss", parse: parseReddit, poll: pollReddit },
  "hn.algolia": { pluginKey: "hn.algolia", parse: parseHn, poll: pollHn },
  "youtube.channel_rss": { pluginKey: "youtube.channel_rss", parse: parseYouTube, poll: pollYouTube },
  "medium.tag_rss": { pluginKey: "medium.tag_rss", parse: parseMedium, poll: pollMedium },
  "ddg.html": { pluginKey: "ddg.html", parse: parseDdg, poll: pollDdg },
};

export function adapterFor(pluginKey: string): MentionAdapter | null {
  return ADAPTERS[pluginKey] ?? null;
}

export function targetFromWatch(pluginKey: string, targetKey: string): MentionTarget {
  if (pluginKey === "youtube.channel_rss") {
    return { query: targetKey, channelId: targetKey, tag: null };
  }
  if (pluginKey === "medium.tag_rss") {
    return { query: targetKey, channelId: null, tag: targetKey };
  }
  return { query: targetKey, channelId: null, tag: null };
}
