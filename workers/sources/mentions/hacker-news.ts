import { z } from "zod";

import type { MentionItem, MentionsAdapter } from "./types";
import { fetchUpstream, webItems } from "./types";

const SEARCH = "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=30&query=";

const ITEM = "https://news.ycombinator.com/item?id=";

const hitsSchema = z.object({
  hits: z.array(
    z.object({
      objectID: z.string().min(1),
      title: z.string().nullish(),
      url: z.string().nullish(),
      created_at: z.string().nullish(),
    }),
  ),
});

export const hackerNews: MentionsAdapter = async (target) => {
  const response = await fetchUpstream(SEARCH + encodeURIComponent(target.query));
  if (!response.ok) throw new Error(`hn algolia answered ${String(response.status)}`);
  const rawBody = await response.text();
  const parsed = hitsSchema.parse(JSON.parse(rawBody));
  const items: MentionItem[] = webItems(parsed.hits.flatMap((hit) =>
    hit.title
      ? [
          {
            dedupKey: hit.objectID,
            url: hit.url?.startsWith("https://") || hit.url?.startsWith("http://") ? hit.url : ITEM + hit.objectID,
            title: hit.title,
            publisher: "Hacker News",
            publishedAt: hit.created_at ?? null,
          },
        ]
      : [],
  ));
  return { items, rawBody };
};
