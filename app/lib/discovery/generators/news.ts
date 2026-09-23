import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";

import { coMentions } from "../co-mentions";
import type { Candidate, Evidence, FetchText, Generator, Subject } from "../types";

const SEARCH_URL = "https://news.google.com/rss/search?hl=en-GB&gl=GB&ceid=GB:en&q=";

const TIMEOUT_MS = 8_000;

interface NewsEntry {
  title: string;
  link: string;
  publisher: string | undefined;
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

function parseEntries(body: string): NewsEntry[] {
  let entries: FeedEntry[];
  try {
    const feed = extractFromXml(body, {
      getExtraEntryFields: (entryData) => ({
        publisher:
          (entryData.source as { "@_url": string } | undefined)?.["@_url"],
      }),
    });
    entries = feed.entries ?? [];
  } catch {
    return [];
  }

  const parsed: NewsEntry[] = [];
  for (const entry of entries) {
    const title = entry.title;
    if (typeof title !== "string" || title.length === 0) continue;
    const publisher = entry.publisher;
    parsed.push({
      title,
      link: typeof entry.link === "string" ? entry.link : "",
      publisher:
        typeof publisher === "string" && publisher.length > 0 ? publisher : undefined,
    });
  }
  return parsed;
}

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
          sourceUrl: entry.publisher ?? entry.link,
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
