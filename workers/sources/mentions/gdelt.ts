import type { MentionsAdapter } from "./types";
import { fetchUpstream, mentionItemSchema } from "./types";
import {
  GDELT_SEARCH_URL,
  gdeltResponseSchema,
  gdeltSeendateToIso,
} from "../../../app/lib/discovery/gdelt";

function parseBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    throw new Error(`gdelt answered with text, not JSON: ${rawBody.slice(0, 120)}`, { cause: error });
  }
}

export const gdelt: MentionsAdapter = async (target, _cursor) => {
  const response = await fetchUpstream(GDELT_SEARCH_URL + encodeURIComponent(`"${target.query}"`));
  if (!response.ok) throw new Error(`gdelt answered ${String(response.status)}`);
  const rawBody = await response.text();
  const parsed = gdeltResponseSchema.parse(parseBody(rawBody));
  const items = parsed.articles.flatMap((article) => {
    const item = mentionItemSchema.safeParse({
      dedupKey: article.url,
      url: article.url,
      title: article.title,
      publisher: article.domain ?? null,
      publishedAt: gdeltSeendateToIso(article.seendate),
    });
    return item.success ? [item.data] : [];
  });
  return { items, canaryCount: parsed.articles.length, rawBody };
};
