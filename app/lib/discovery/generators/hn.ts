import { z } from "zod";

import { coMentions } from "../co-mentions";
import {
  defaultFetchText,
  type Candidate,
  type Evidence,
  type FetchText,
  type Generator,
  type Subject,
} from "../types";

const SEARCH_URL = "https://hn.algolia.com/api/v1/search?query=";

const SEARCH_PARAMS = "&tags=(story,comment)&hitsPerPage=100";

const EVIDENCE_URL = "https://news.ycombinator.com/item?id=";

const HIT_SCHEMA = z.object({
  objectID: z.string(),
  title: z.string().nullish(),
  story_title: z.string().nullish(),
});

const HITS_SCHEMA = z.object({ hits: z.array(HIT_SCHEMA) });

type Hit = z.infer<typeof HIT_SCHEMA>;

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    console.error(JSON.stringify({ event: "discovery.hn_unparseable", error: String(error) }));
    return null;
  }
}

function parseHits(body: string): Hit[] | null {
  const result = HITS_SCHEMA.safeParse(parseJson(body));
  return result.success ? result.data.hits : null;
}

function headlineOf(hit: Hit): string | null {
  const headline = hit.title ?? hit.story_title;
  if (headline === undefined || headline === null || headline.length === 0) return null;
  return headline;
}

export const hnGenerator: Generator = async (subject: Subject, fetchText?: FetchText) => {
  const fetchFn = fetchText ?? defaultFetchText("discovery.hn_fetch_failed");
  const page = await fetchFn(SEARCH_URL + encodeURIComponent(subject.name) + SEARCH_PARAMS);
  if (!page.ok) return [];

  const hits = parseHits(page.body);
  if (hits === null) return [];

  const merged = new Map<string, { name: string; evidence: Evidence[] }>();
  for (const hit of hits) {
    const headline = headlineOf(hit);
    if (headline === null) continue;

    for (const name of coMentions(headline, subject.name)) {
      const key = name.toLowerCase();
      const item: Evidence = {
        sourceUrl: EVIDENCE_URL + hit.objectID,
        excerpt: headline,
        generator: "hn",
      };
      const existing = merged.get(key);
      merged.set(key, {
        name: existing === undefined ? name : existing.name,
        evidence: existing === undefined ? [item] : [...existing.evidence, item],
      });
    }
  }

  const candidates: Candidate[] = [...merged.values()].map((entry) => ({
    name: entry.name,
    evidence: entry.evidence,
  }));
  return candidates;
};
