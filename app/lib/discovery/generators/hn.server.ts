import { z } from "zod";

import { coMentions } from "../co-mentions";
import { htmlToText } from "../html-text";
import { defaultFetchText } from "../fetch-text.server";
import {
  assertFetched,
  logIfEmpty,
  type Candidate,
  type Evidence,
  type FetchText,
  type Generator,
  type Subject,
} from "../types";

const SEARCH_URL = "https://hn.algolia.com/api/v1/search?query=";

const SEARCH_PARAMS = "&tags=(story,comment)&hitsPerPage=100";

const EVIDENCE_URL = "https://news.ycombinator.com/item?id=";

const FETCH_TIMEOUT_MS = 5_000;

const EXCERPT_MAX = 280;

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

const HIT_SCHEMA = z.object({
  objectID: z.string(),
  title: z.string().nullish(),
  story_title: z.string().nullish(),
  story_text: z.string().nullish(),
  comment_text: z.string().nullish(),
});

const HITS_SCHEMA = z.object({ hits: z.array(HIT_SCHEMA) });

type Hit = z.infer<typeof HIT_SCHEMA>;

type Merge = Map<string, { name: string; evidence: Evidence[] }>;

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

async function sentencesOf(hit: Hit): Promise<string[]> {
  const fields = [hit.title, hit.story_title, hit.story_text, hit.comment_text];
  const texts = await Promise.all(
    fields.map(async (field) => (field === undefined || field === null ? "" : htmlToText(field))),
  );
  return texts.flatMap((text) =>
    text
      .split(SENTENCE_SPLIT)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0),
  );
}

function addEvidence(merged: Merge, name: string, evidence: Evidence): void {
  const key = name.toLowerCase();
  const existing = merged.get(key);
  if (existing === undefined) {
    merged.set(key, { name, evidence: [evidence] });
    return;
  }
  if (existing.evidence.some((item) => item.sourceUrl === evidence.sourceUrl)) return;
  merged.set(key, { name: existing.name, evidence: [...existing.evidence, evidence] });
}

async function collect(hits: readonly Hit[], brand: string): Promise<{ merged: Merge; texts: number }> {
  const merged: Merge = new Map();
  let texts = 0;
  for (const hit of hits) {
    const sentences = await sentencesOf(hit);
    if (sentences.length > 0) texts += 1;
    for (const sentence of sentences) {
      for (const name of coMentions(sentence, brand)) {
        addEvidence(merged, name, {
          sourceUrl: EVIDENCE_URL + hit.objectID,
          excerpt: sentence.slice(0, EXCERPT_MAX),
          generator: "hn",
        });
      }
    }
  }
  return { merged, texts };
}

export const hnGenerator: Generator = async (subject: Subject, fetchText?: FetchText) => {
  const fetchFn = fetchText ?? defaultFetchText("discovery.hn_fetch_failed", FETCH_TIMEOUT_MS);
  const page = await fetchFn(SEARCH_URL + encodeURIComponent(subject.name) + SEARCH_PARAMS);
  assertFetched("hn", page);

  const hits = parseHits(page.body);
  if (hits === null) return [];

  const { merged, texts } = await collect(hits, subject.name);
  const candidates: Candidate[] = [...merged.values()].map((entry) => ({
    name: entry.name,
    evidence: entry.evidence,
  }));
  logIfEmpty("hn", texts, candidates);
  return candidates;
};
