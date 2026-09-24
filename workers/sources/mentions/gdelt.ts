import { z } from "zod";

import type { MentionsAdapter } from "./types";
import { fetchUpstream, mentionItemSchema } from "./types";

const SEARCH =
  "https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=50&timespan=2d&sort=datedesc&query=";

const articlesSchema = z.object({
  articles: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().min(1),
        seendate: z.string().nullish(),
        domain: z.string().nullish(),
      }),
    )
    .default([]),
});

function isoOf(seendate: string | null | undefined): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate ?? "");
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

function parseBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    throw new Error(`gdelt answered with text, not JSON: ${rawBody.slice(0, 120)}`, { cause: error });
  }
}

export const gdelt: MentionsAdapter = async (target, _cursor) => {
  const response = await fetchUpstream(SEARCH + encodeURIComponent(`"${target.query}"`));
  if (!response.ok) throw new Error(`gdelt answered ${String(response.status)}`);
  const rawBody = await response.text();
  const parsed = articlesSchema.parse(parseBody(rawBody));
  const items = parsed.articles.flatMap((article) => {
    const item = mentionItemSchema.safeParse({
      dedupKey: article.url,
      url: article.url,
      title: article.title,
      publisher: article.domain ?? null,
      publishedAt: isoOf(article.seendate),
    });
    return item.success ? [item.data] : [];
  });
  return { items, canaryCount: parsed.articles.length, rawBody };
};
