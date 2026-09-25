import { z } from "zod";

import { coMentions } from "../co-mentions";
import type { Candidate, Evidence, FetchText, Generator, Subject } from "../types";
import { GDELT_SEARCH_URL, gdeltResponseSchema, gdeltWebUrlSchema } from "../gdelt";

const TIMEOUT_MS = 8_000;

const NEWS_ARTICLE_SCHEMA = z.object({
  title: z.string().min(1),
  domain: z.string().min(1),
  url: gdeltWebUrlSchema,
});

type NewsArticle = z.infer<typeof NEWS_ARTICLE_SCHEMA>;

function parseArticles(body: string): NewsArticle[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch {
    return [];
  }

  const response = gdeltResponseSchema.safeParse(raw);
  if (!response.success) return [];

  const parsed: NewsArticle[] = [];
  for (const article of response.data.articles) {
    const result = NEWS_ARTICLE_SCHEMA.safeParse(article);
    if (result.success) parsed.push(result.data);
  }
  return parsed;
}

type Merge = Map<string, { name: string; evidence: Evidence[] }>;

function addCandidate(merged: Merge, name: string, evidence: Evidence): void {
  const key = name.toLowerCase();
  const existing = merged.get(key);
  merged.set(key, {
    name: existing === undefined ? name : existing.name,
    evidence: existing === undefined ? [evidence] : [...existing.evidence, evidence],
  });
}

const defaultFetchText: FetchText = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return {
      ok: response.ok,
      url: response.url,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
  } catch {
    return { ok: false, url, contentType: null, body: "" };
  }
};

export const newsGenerator: Generator = async (subject: Subject, fetchText?: FetchText) => {
  const fetchFn = fetchText ?? defaultFetchText;
  const page = await fetchFn(GDELT_SEARCH_URL + encodeURIComponent(`"${subject.name}"`));
  if (!page.ok) return [];

  const merged: Merge = new Map<string, { name: string; evidence: Evidence[] }>();
  for (const article of parseArticles(page.body)) {
    for (const name of coMentions(article.title, subject.name)) {
      addCandidate(merged, name, {
        sourceUrl: article.domain,
        excerpt: article.title,
        generator: "news",
      });
    }
  }

  const candidates: Candidate[] = [...merged.values()].map((entry) => ({
    name: entry.name,
    evidence: entry.evidence,
  }));
  return candidates;
};
