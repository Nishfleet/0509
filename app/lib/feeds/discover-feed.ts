import { attributes } from "./parse-feed";

export const COMMON_FEED_PATHS: readonly string[] = [
  "/feed",
  "/rss.xml",
  "/atom.xml",
  "/blog/feed",
  "/changelog.xml",
  "/changelog/rss.xml",
  "/changelog/feed.xml",
  "/blog/rss.xml",
  "/feed.xml",
];

export const MAX_FEED_CANDIDATES = 12;

const FEED_TYPES: ReadonlySet<string> = new Set(["application/rss+xml", "application/atom+xml"]);

const MAX_LINK_TAGS = 400;

const MAX_LINK_TAG_CHARS = 2_000;

function httpsHref(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || !URL.canParse(trimmed, base)) return null;
  const url = new URL(trimmed, base);
  url.hash = "";
  return url.protocol === "https:" ? url.href : null;
}

function linkTags(html: string): string[] {
  const lower = html.replace(/[A-Z]+/g, (run) => run.toLowerCase());
  const tags: string[] = [];
  let at = lower.indexOf("<link");
  while (at !== -1 && tags.length < MAX_LINK_TAGS) {
    const end = lower.indexOf(">", at + 5);
    if (end === -1) break;
    const boundary = /[\s>/]/.test(lower.charAt(at + 5));
    if (boundary && end - at <= MAX_LINK_TAG_CHARS) tags.push(html.slice(at + 5, end));
    at = lower.indexOf("<link", end + 1);
  }
  return tags;
}

export function feedLinksFromHtml(html: string, base: string): string[] {
  const found: string[] = [];
  for (const tag of linkTags(html)) {
    const attrs = attributes(tag);
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
