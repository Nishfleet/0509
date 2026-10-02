import { attributes } from "./parse-feed";

export const COMMON_FEED_PATHS: readonly string[] = ["/feed", "/rss.xml", "/atom.xml", "/blog/feed", "/changelog.xml"];

export const MAX_FEED_CANDIDATES = 8;

const FEED_TYPES: ReadonlySet<string> = new Set(["application/rss+xml", "application/atom+xml"]);

const LINK_TAG = /<link\b[^>]*>/gi;

function httpsHref(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || !URL.canParse(trimmed, base)) return null;
  const url = new URL(trimmed, base);
  url.hash = "";
  return url.protocol === "https:" ? url.href : null;
}

export function feedLinksFromHtml(html: string, base: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(LINK_TAG)) {
    const attrs = attributes(match[0]);
    const type = attrs.get("type")?.trim().toLowerCase();
    const rel = attrs.get("rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = attrs.get("href");
    if (type === undefined || !FEED_TYPES.has(type) || !rel.includes("alternate") || href === undefined) continue;
    const resolved = httpsHref(href, base);
    if (resolved !== null) found.push(resolved);
  }
  return found;
}

export function feedCandidates(html: string | null, homepage: string): string[] {
  const declared = html === null ? [] : feedLinksFromHtml(html, homepage);
  const common = COMMON_FEED_PATHS.flatMap((path) => httpsHref(path, homepage) ?? []);
  return [...new Set([...declared, ...common])].slice(0, MAX_FEED_CANDIDATES);
}
