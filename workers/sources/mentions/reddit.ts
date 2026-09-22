import { blankToNull, feedEntries, textOf } from "./feed";
import {
  adapterResultSchema,
  fetchUpstream,
  type MentionItem,
  type MentionTarget,
  UpstreamStatus,
} from "./types";

const PLUGIN_KEY = "reddit.search_rss";

function redditStoryId(id: string | undefined): string | null {
  if (!id) return null;
  const match = /t3_[a-z0-9]+/i.exec(id);
  return match ? match[0] : null;
}

export function parseReddit(xml: string): MentionItem[] {
  const items: MentionItem[] = [];
  for (const entry of feedEntries(xml)) {
    const dedupKey = redditStoryId(entry.id);
    const canonicalUrl = blankToNull(entry.link);
    if (!dedupKey || !canonicalUrl) continue;
    const updated = typeof entry.updated === "string" ? entry.updated : entry.published;
    items.push({
      dedupKey,
      title: entry.title ?? "",
      bodyExcerpt: entry.description ?? "",
      canonicalUrl,
      publishedAt: blankToNull(updated),
      author: textOf(entry.author),
      publisher: null,
      engagement: {},
    });
  }
  items.sort((a, b) => {
    const left = a.publishedAt ?? "";
    const right = b.publishedAt ?? "";
    return right.localeCompare(left);
  });
  return items;
}

export async function pollReddit(target: MentionTarget, _cursor: string | null) {
  const url = new URL("https://www.reddit.com/search.rss");
  url.searchParams.set("q", target.query);
  url.searchParams.set("sort", "new");
  const { status, body } = await fetchUpstream(url.toString());
  if (status !== 200) throw new UpstreamStatus(PLUGIN_KEY, status);
  const items = parseReddit(body);
  return adapterResultSchema.parse({ items, canaryCount: items.length, rawBody: body, status });
}
