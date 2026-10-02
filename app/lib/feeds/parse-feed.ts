export interface FeedItem {
  id: string;
  title: string;
  url: string;
  excerpt: string | null;
  publishedAt: string | null;
}

export interface KeyedFeedItem extends FeedItem {
  key: string;
}

export const MAX_FEED_ITEMS = 20;

export const MAX_ITEM_AGE_DAYS = 30;

const MAX_TITLE_CHARS = 200;

const MAX_EXCERPT_CHARS = 200;

const MAX_BLOCKS = 200;

const DAY_MS = 86_400_000;

const FEED_ROOT = /<(rss|feed)[\s>]/i;

const ENTRY_BLOCK = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;

const LINK_TAG = /<link\b([^>]*?)(?:\/>|>([\s\S]*?)<\/link\s*>)/gi;

const ATTRIBUTE = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function codePoint(value: number): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, digits: string) => codePoint(Number.parseInt(digits, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/&amp;/g, "&");
}

function unwrapCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_match, inner: string) => inner);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function plainText(raw: string, limit: number): string {
  const decoded = decodeEntities(unwrapCdata(raw));
  const withoutTags = decoded.replace(/<[^>]*>/g, " ");
  const text = collapse(decodeEntities(withoutTags));
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function firstTag(block: string, names: readonly string[]): string | null {
  for (const name of names) {
    const found = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, "i").exec(block);
    const inner = found?.[1];
    if (inner !== undefined) return inner;
  }
  return null;
}

export function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined && !found.has(name)) found.set(name, decodeEntities(match[2] ?? match[3] ?? ""));
  }
  return found;
}

function resolveHttp(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || !URL.canParse(trimmed, base)) return null;
  const url = new URL(trimmed, base);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}

function entryLink(block: string, base: string): string | null {
  let textual: string | null = null;
  for (const match of block.matchAll(LINK_TAG)) {
    const attrs = attributes(match[1] ?? "");
    const href = attrs.get("href");
    if (href !== undefined) {
      const rel = attrs.get("rel");
      if (rel === undefined || rel.toLowerCase() === "alternate") return resolveHttp(href, base);
      continue;
    }
    const text = match[2];
    if (textual === null && text !== undefined) textual = collapse(decodeEntities(unwrapCdata(text)));
  }
  return textual === null ? null : resolveHttp(textual, base);
}

function entryDate(block: string): string | null {
  const raw = firstTag(block, ["pubDate", "published", "updated", "dc:date"]);
  if (raw === null) return null;
  const parsed = Date.parse(collapse(decodeEntities(unwrapCdata(raw))));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function entryId(block: string, url: string): string {
  const raw = firstTag(block, ["guid", "id"]);
  const id = raw === null ? "" : collapse(decodeEntities(unwrapCdata(raw)));
  return id === "" ? url : id;
}

function toItem(block: string, base: string): FeedItem | null {
  const url = entryLink(block, base);
  const rawTitle = firstTag(block, ["title"]);
  if (url === null || rawTitle === null) return null;
  const title = plainText(rawTitle, MAX_TITLE_CHARS);
  if (title === "") return null;
  const rawExcerpt = firstTag(block, ["description", "summary"]);
  const excerpt = rawExcerpt === null ? "" : plainText(rawExcerpt, MAX_EXCERPT_CHARS);
  return {
    id: entryId(block, url),
    title,
    url,
    excerpt: excerpt === "" ? null : excerpt,
    publishedAt: entryDate(block),
  };
}

function newestFirst(items: readonly FeedItem[]): FeedItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = a.item.publishedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(a.item.publishedAt);
      const right = b.item.publishedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(b.item.publishedAt);
      return left === right ? a.index - b.index : right - left;
    })
    .map(({ item }) => item);
}

export function isFeedDocument(xml: string): boolean {
  return FEED_ROOT.test(xml.slice(0, 4096));
}

export function parseFeed(xml: string, base: string, now: Date): FeedItem[] | null {
  if (!isFeedDocument(xml)) return null;
  const cutoff = now.getTime() - MAX_ITEM_AGE_DAYS * DAY_MS;
  const items: FeedItem[] = [];
  for (const match of xml.matchAll(ENTRY_BLOCK)) {
    if (items.length >= MAX_BLOCKS) break;
    const item = toItem(match[2] ?? "", base);
    if (item === null) continue;
    if (item.publishedAt !== null && Date.parse(item.publishedAt) < cutoff) continue;
    items.push(item);
  }
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return newestFirst(unique).slice(0, MAX_FEED_ITEMS);
}

export async function itemKey(id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function keyItems(items: readonly FeedItem[]): Promise<KeyedFeedItem[]> {
  return Promise.all(items.map(async (item) => ({ ...item, key: await itemKey(item.id) })));
}

export async function hashItemKeys(items: readonly KeyedFeedItem[]): Promise<string> {
  return itemKey(
    items
      .map((item) => item.key)
      .sort()
      .join("\n"),
  );
}
