import { getDomain, parse } from "tldts";

import { namesFromTitle } from "../names";
import {
  normaliseName,
  type Candidate,
  type Generator,
} from "../types";

export const HN_GENERATOR = "hn-algolia-comentions";
const HN_HOST = "news.ycombinator.com";

interface HnHit {
  objectID?: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  comment_text?: string | null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function domainsFromHit(hit: HnHit, subjectDomain: string): string[] {
  const urls = new Set<string>();
  if (hit.url) urls.add(hit.url);
  const comment = decodeEntities(hit.comment_text ?? "");
  for (const m of comment.matchAll(/href="([^"]+)"/g)) urls.add(m[1]);
  for (const m of comment.matchAll(/https?:\/\/[^\s"'<>()]+/g)) urls.add(m[0]);
  const domains = new Set<string>();
  for (const url of urls) {
    const domain = getDomain(url);
    if (domain && domain !== subjectDomain && domain !== "ycombinator.com") domains.add(domain);
  }
  return [...domains];
}

function prettify(domain: string): string {
  const stem = parse(domain).domainWithoutSuffix ?? domain;
  return stem
    .split(/[-.]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export const hnCoMentions: Generator = async (subject, env) => {
  const fetchImpl = env.fetchImpl ?? fetch;
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(subject.name)}&tags=(story,comment)&hitsPerPage=50`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!res?.ok) return [];
  const raw = await res.text();
  env.onPayload?.({ url, contentType: "application/json", body: raw });
  const data = JSON.parse(raw) as { hits?: HnHit[] };
  const selfNorm = normaliseName(subject.name);
  const byKey = new Map<string, Candidate>();
  const add = (name: string, domain: string | undefined, sourceUrl: string, excerpt: string) => {
    const norm = normaliseName(name);
    if (!norm || norm === selfNorm || (domain && domain === subject.domain)) return;
    const key = domain ?? `name:${norm}`;
    const evidence = { sourceUrl, excerpt: excerpt.slice(0, 300), generator: HN_GENERATOR, publisherDomain: HN_HOST };
    const existing = byKey.get(key);
    if (existing) existing.evidence.push(evidence);
    else byKey.set(key, { name, ...(domain ? { domain } : {}), evidence: [evidence] });
  };
  for (const hit of data.hits ?? []) {
    const permalink = `https://${HN_HOST}/item?id=${hit.objectID ?? ""}`;
    const title = hit.title ?? hit.story_title ?? "";
    for (const domain of domainsFromHit(hit, subject.domain)) {
      add(prettify(domain), domain, permalink, title || decodeEntities(hit.comment_text ?? ""));
    }
    for (const name of namesFromTitle(title, subject.name)) {
      add(name, undefined, permalink, title);
    }
  }
  return [...byKey.values()];
};
