import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedData } from "@extractus/feed-extractor";
import { z } from "zod";

import { coMentions } from "../co-mentions";
import type { Candidate, Evidence, FetchText, Generator, Subject } from "../types";

const SEARCH_URL = "https://news.google.com/rss/search?hl=en-GB&gl=GB&ceid=GB:en&q=";

const TIMEOUT_MS = 8_000;

const SOURCE_SCHEMA = z.object({ "@_url": z.string().min(1) });

const ENTRY_SCHEMA = z
  .object({
    title: z.string().min(1),
    link: z.string().nullish(),
    publisher: z.string().min(1).nullish(),
  })
  .transform((entry) => ({
    title: entry.title,
    sourceUrl: entry.publisher ?? entry.link ?? "",
  }))
  .refine((entry): entry is { title: string; sourceUrl: string } => entry.sourceUrl.length > 0);

type Entry = z.infer<typeof ENTRY_SCHEMA>;

function rawPublisherOf(entryData: Record<string, unknown>): string | undefined {
  const source = SOURCE_SCHEMA.safeParse(entryData.source);
  return source.success ? source.data["@_url"] : undefined;
}

function parseEntries(body: string): Entry[] {
  let feed: FeedData;
  try {
    feed = extractFromXml(body, {
      getExtraEntryFields: (entryData) => ({ publisher: rawPublisherOf(entryData) }),
    });
  } catch {
    return [];
  }

  const parsed: Entry[] = [];
  for (const rawEntry of feed.entries ?? []) {
    const result = ENTRY_SCHEMA.safeParse(rawEntry);
    if (result.success) parsed.push(result.data);
  }
  return parsed;
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
  const queries = [`"${subject.name}" alternatives`, `"${subject.name}"`];
  const pages = await Promise.allSettled(
    queries.map((query) => fetchFn(SEARCH_URL + encodeURIComponent(query))),
  );

  const merged = new Map<string, { name: string; evidence: Evidence[] }>();
  for (const page of pages) {
    if (page.status !== "fulfilled") continue;
    if (!page.value.ok) continue;

    for (const entry of parseEntries(page.value.body)) {
      for (const name of coMentions(entry.title, subject.name)) {
        const key = name.toLowerCase();
        const item: Evidence = {
          sourceUrl: entry.sourceUrl,
          excerpt: entry.title,
          generator: "news",
        };
        const existing = merged.get(key);
        merged.set(key, {
          name: existing === undefined ? name : existing.name,
          evidence: existing === undefined ? [item] : [...existing.evidence, item],
        });
      }
    }
  }

  const candidates: Candidate[] = [...merged.values()].map((entry) => ({
    name: entry.name,
    evidence: entry.evidence,
  }));
  return candidates;
};
