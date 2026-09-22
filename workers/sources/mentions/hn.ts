import { z } from "zod";

import {
  adapterResultSchema,
  fetchUpstream,
  type MentionItem,
  type MentionTarget,
  UpstreamStatus,
} from "./types";

const PLUGIN_KEY = "hn.algolia";

const hitSchema = z.object({
  objectID: z.string().min(1),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  points: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  created_at_i: z.number().nullable().optional(),
  story_text: z.string().nullable().optional(),
});

const responseSchema = z.object({
  hits: z.array(hitSchema),
});

export function parseHn(body: string): MentionItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  const result = responseSchema.safeParse(parsed);
  if (!result.success) return [];
  const items: MentionItem[] = [];
  for (const hit of result.data.hits) {
    const canonicalUrl =
      hit.url?.startsWith("http")
        ? hit.url
        : `https://news.ycombinator.com/item?id=${hit.objectID}`;
    const publishedAt =
      typeof hit.created_at_i === "number"
        ? new Date(hit.created_at_i * 1000).toISOString()
        : null;
    const engagement: Record<string, number> = {};
    if (typeof hit.points === "number") engagement.points = hit.points;
    if (typeof hit.num_comments === "number") engagement.comments = hit.num_comments;
    items.push({
      dedupKey: hit.objectID,
      title: hit.title ?? "",
      bodyExcerpt: hit.story_text ?? "",
      canonicalUrl,
      publishedAt,
      author: hit.author ?? null,
      publisher: "news.ycombinator.com",
      engagement,
    });
  }
  return items;
}

export async function pollHn(target: MentionTarget, _cursor: string | null) {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", target.query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", "20");
  const { status, body } = await fetchUpstream(url.toString());
  if (status !== 200) throw new UpstreamStatus(PLUGIN_KEY, status);
  const items = parseHn(body);
  return adapterResultSchema.parse({ items, canaryCount: items.length, rawBody: body, status });
}
