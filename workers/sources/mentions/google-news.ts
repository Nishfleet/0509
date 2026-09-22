import { blankToNull, feedEntries, publisherHost, textOf } from "./feed";
import {
  adapterResultSchema,
  fetchUpstream,
  type MentionItem,
  type MentionTarget,
  UpstreamStatus,
} from "./types";

const PLUGIN_KEY = "news.google_rss";

export function parseGoogleNews(xml: string): MentionItem[] {
  const items: MentionItem[] = [];
  for (const entry of feedEntries(xml)) {
    const canonicalUrl = blankToNull(entry.link);
    const dedupKey = blankToNull(entry.id);
    if (!canonicalUrl || !dedupKey) continue;
    items.push({
      dedupKey,
      title: entry.title ?? "",
      bodyExcerpt: entry.description ?? "",
      canonicalUrl,
      publishedAt: blankToNull(entry.published),
      author: textOf(entry.author),
      publisher: publisherHost(entry.source),
      engagement: {},
    });
  }
  return items;
}

export async function pollGoogleNews(target: MentionTarget, _cursor: string | null) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", `"${target.query}"`);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const { status, body } = await fetchUpstream(url.toString());
  if (status !== 200) throw new UpstreamStatus(PLUGIN_KEY, status);
  const items = parseGoogleNews(body);
  return adapterResultSchema.parse({ items, canaryCount: items.length, rawBody: body, status });
}
