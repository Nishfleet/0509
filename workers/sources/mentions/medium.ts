import { blankToNull, feedEntries, textOf } from "./feed";
import {
  adapterResultSchema,
  fetchUpstream,
  type MentionItem,
  type MentionTarget,
  UpstreamStatus,
} from "./types";

const PLUGIN_KEY = "medium.tag_rss";
const TAG = /^[\w.-]+$/;

export function parseMedium(xml: string): MentionItem[] {
  const items: MentionItem[] = [];
  for (const entry of feedEntries(xml)) {
    const guid = blankToNull(entry.id);
    if (!guid?.startsWith("http")) continue;
    items.push({
      dedupKey: guid,
      title: entry.title ?? "",
      bodyExcerpt: entry.description ?? "",
      canonicalUrl: guid,
      publishedAt: blankToNull(entry.published),
      author: textOf(entry.author),
      publisher: "medium.com",
      engagement: {},
    });
  }
  return items;
}

export async function pollMedium(target: MentionTarget, _cursor: string | null) {
  const tag = target.tag ?? target.query;
  if (!TAG.test(tag)) throw new UpstreamStatus(PLUGIN_KEY, 404);
  const { status, body } = await fetchUpstream(`https://medium.com/feed/tag/${encodeURIComponent(tag)}`);
  if (status !== 200) throw new UpstreamStatus(PLUGIN_KEY, status);
  const items = parseMedium(body);
  return adapterResultSchema.parse({ items, canaryCount: items.length, rawBody: body, status });
}
