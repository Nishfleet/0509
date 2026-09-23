import { extractFromXml } from "@extractus/feed-extractor";
import { getDomain } from "tldts";

import { cleanCandidateName, namesFromTitle } from "../names";
import {
  normaliseName,
  type Candidate,
  type DiscoverySubject,
  type GeneratorEnv,
} from "../types";

export const NEWS_GENERATOR = "google-news-roundup";

const ARTICLE_LIMIT = 5;
const QUERY_TEMPLATES = ['"%s" alternatives', '"%s" vs', 'like "%s"'];

export interface NewsItem {
  title: string;
  link: string;
  publisherDomain: string | null;
}

export function parseNewsFeed(xml: string): NewsItem[] {
  const entries = extractFromXml(xml).entries ?? [];
  const itemXml = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].map((m) => m[0]);
  return entries
    .map((entry, i) => {
      const sourceUrl = itemXml[i] ? /<source[^>]*url="([^"]+)"/.exec(itemXml[i])?.[1] : undefined;
      return {
        title: entry.title ?? "",
        link: entry.link ?? "",
        publisherDomain: sourceUrl ? getDomain(sourceUrl) : null,
      };
    })
    .filter((item) => item.link.length > 0 && item.title.length > 0);
}

export async function extractRoundupNames(html: string, subjectName: string): Promise<string[]> {
  if (typeof HTMLRewriter === "undefined") return [];
  const scoped: string[] = [];
  const loose: string[] = [];
  const makeHandler = (target: string[]) => {
    let buf = "";
    return {
      text(node: { text: string; lastInTextNode: boolean }) {
        buf += node.text;
        if (node.lastInTextNode) {
          target.push(buf);
          buf = "";
        }
      },
    };
  };
  await new HTMLRewriter()
    .on("article h2, article h3, article h4, article strong, article b", makeHandler(scoped))
    .on("h2, h3", makeHandler(loose))
    .transform(new Response(html))
    .text();
  const pool = scoped.length > 0 ? scoped : loose;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of pool) {
    for (const name of [...namesFromTitle(raw, subjectName), cleanCandidateName(raw)]) {
      const norm = name ? normaliseName(name) : "";
      if (name && norm && !seen.has(norm)) {
        seen.add(norm);
        names.push(name);
      }
    }
  }
  return names;
}

export async function googleNewsRoundups(
  subject: DiscoverySubject,
  env: GeneratorEnv = {},
): Promise<Candidate[]> {
  const fetchImpl = env.fetchImpl ?? fetch;
  const items: NewsItem[] = [];
  for (const template of QUERY_TEMPLATES) {
    const q = encodeURIComponent(template.replace("%s", subject.name));
    const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (res?.ok) {
      const body = await res.text();
      env.onPayload?.({ url, contentType: "application/rss+xml", body });
      items.push(...parseNewsFeed(body));
    }
  }
  const seenLinks = new Set<string>();
  const uniqueItems = items.filter((item) => !seenLinks.has(item.link) && seenLinks.add(item.link));
  const selfNorm = normaliseName(subject.name);
  const byName = new Map<string, Candidate>();
  const add = (name: string, item: NewsItem, excerpt: string) => {
    const norm = normaliseName(name);
    if (!norm || norm === selfNorm) return;
    const evidence = {
      sourceUrl: item.link,
      excerpt,
      generator: NEWS_GENERATOR,
      ...(item.publisherDomain ? { publisherDomain: item.publisherDomain } : {}),
    };
    const existing = byName.get(norm);
    if (existing) existing.evidence.push(evidence);
    else byName.set(norm, { name, evidence: [evidence] });
  };
  for (const item of uniqueItems) {
    for (const name of namesFromTitle(item.title, subject.name)) add(name, item, item.title);
  }
  for (const item of uniqueItems.slice(0, ARTICLE_LIMIT)) {
    const res = await fetchImpl(item.link, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!res?.ok) continue;
    const body = await res.text();
    env.onPayload?.({ url: item.link, contentType: "text/html", body });
    for (const name of await extractRoundupNames(body, subject.name)) {
      add(name, item, item.title);
    }
  }
  return [...byName.values()];
}
