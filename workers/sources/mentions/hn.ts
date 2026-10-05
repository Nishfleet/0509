import { z } from "zod";
import { fetchUpstream, type MentionsAdapter, type MentionsCursor, type MentionsResult } from "./types";

const algoliaSchema = z.object({
  hits: z.array(
    z.object({
      objectID: z.string(),
      title: z.string().nullable(),
      url: z.string().nullable().optional(),
      created_at: z.string(),
    }),
  ),
});

export function parseHn(rawBody: string): MentionsResult {
  const { hits } = algoliaSchema.parse(JSON.parse(rawBody));
  const items = hits.map((hit) => {
    const upstreamUrl = hit.url ?? "";
    return {
      dedupKey: hit.objectID,
      url: upstreamUrl.length > 0 ? upstreamUrl : "https://news.ycombinator.com/item?id=" + hit.objectID,
      title: hit.title ?? "",
      publishedAt: hit.created_at,
    };
  });
  return { items, canaryCount: hits.length, rawBody };
}

const WINDOW_SECONDS = 7 * 24 * 60 * 60;

function lowerBound(cursor: MentionsCursor): number {
  const parsed = Number(cursor);
  const stored = cursor !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  return Math.max(stored, Math.floor(Date.now() / 1000) - WINDOW_SECONDS);
}

export const hnAdapter: MentionsAdapter = async (target, cursor) => {
  const url =
    "https://hn.algolia.com/api/v1/search_by_date?query=" +
    encodeURIComponent(target.query) +
    "&tags=story&hitsPerPage=50&numericFilters=" +
    encodeURIComponent("created_at_i>" + String(lowerBound(cursor)));
  const response = await fetchUpstream(url);
  if (!response.ok) {
    throw new Error("hn.algolia " + String(response.status));
  }
  return parseHn(await response.text());
};
