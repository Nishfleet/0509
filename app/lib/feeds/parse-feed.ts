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

export interface FeedScan {
  blocksVisited: number;
  charsScanned: number;
}

export interface ParseFeedOptions {
  now: Date;
  scan?: FeedScan;
}

export const MAX_FEED_ITEMS = 20;

const MAX_ITEM_AGE_DAYS = 30;

const MAX_TITLE_CHARS = 200;

const MAX_EXCERPT_CHARS = 200;

const MAX_BLOCKS = 200;

const MAX_BLOCK_CHARS = 20_000;

const MAX_TAG_CHARS = 2_000;

const MAX_FIELD_CHARS = 8_000;

const DAY_MS = 86_400_000;

const FEED_ROOT = /<(rss|feed)[\s>]/i;

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
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("<![CDATA[", at);
    if (open === -1) return out + text.slice(at);
    const close = text.indexOf("]]>", open + 9);
    if (close === -1) return out + text.slice(at);
    out += text.slice(at, open) + text.slice(open + 9, close);
    at = close + 3;
  }
}

function stripTags(text: string): string {
  let out = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("<", at);
    if (open === -1) return out + text.slice(at);
    const close = text.indexOf(">", open + 1);
    if (close === -1) return out + text.slice(at);
    out += `${text.slice(at, open)} `;
    at = close + 1;
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function plainText(raw: string, limit: number): string {
  const decoded = decodeEntities(unwrapCdata(raw.slice(0, MAX_FIELD_CHARS)));
  const text = collapse(decodeEntities(stripTags(decoded)));
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

const NAME_END = /[\s>/]/;

function scanIndexOf(text: string, needle: string, opts: { from: number; scan?: FeedScan }): number {
  const found = text.indexOf(needle, opts.from);
  if (opts.scan !== undefined) {
    opts.scan.charsScanned += (found === -1 ? text.length : found + needle.length) - opts.from;
  }
  return found;
}

function openTagAt(lower: string, name: string, opts: { from: number; scan?: FeedScan }): { start: number; end: number } | null {
  const needle = `<${name}`;
  let at = scanIndexOf(lower, needle, opts);
  while (at !== -1) {
    const next = lower.charAt(at + needle.length);
    if (NAME_END.test(next)) {
      const end = scanIndexOf(lower, ">", { from: at + needle.length, scan: opts.scan });
      if (end === -1 || end - at > MAX_TAG_CHARS) return null;
      return { start: at, end };
    }
    at = scanIndexOf(lower, needle, { from: at + needle.length, scan: opts.scan });
  }
  return null;
}

interface Element {
  attrs: string;
  inner: string | null;
  after: number;
}

function elementAt(block: Block, name: string, from: number): Element | null {
  const { source, lower } = block;
  const open = openTagAt(lower, name, { from });
  if (open === null) return null;
  const head = source.slice(open.start + name.length + 1, open.end);
  if (head.endsWith("/")) return { attrs: head.slice(0, -1), inner: null, after: open.end + 1 };
  const close = lower.indexOf(`</${name}`, open.end + 1);
  if (close === -1) return { attrs: head, inner: null, after: open.end + 1 };
  const closeEnd = lower.indexOf(">", close);
  return {
    attrs: head,
    inner: source.slice(open.end + 1, close),
    after: closeEnd === -1 ? close + name.length + 2 : closeEnd + 1,
  };
}

function firstTag(block: Block, names: readonly string[]): string | null {
  for (const name of names) {
    const inner = elementAt(block, name, 0)?.inner;
    if (inner !== undefined && inner !== null) return inner;
  }
  return null;
}

interface Block {
  source: string;
  lower: string;
}

function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

function entryBlocks(xml: string, scan: FeedScan): Block[] {
  const lower = asciiLower(xml);
  scan.charsScanned += xml.length;
  const blocks: Block[] = [];
  let at = 0;
  while (blocks.length < MAX_BLOCKS) {
    const items = openTagAt(lower, "item", { from: at, scan });
    const entries = openTagAt(lower, "entry", { from: at, scan });
    const open = items === null ? entries : entries === null || items.start < entries.start ? items : entries;
    if (open === null) break;
    scan.blocksVisited += 1;
    const name = open === items ? "item" : "entry";
    const close = scanIndexOf(lower, `</${name}`, { from: open.end + 1, scan });
    if (close === -1) break;
    at = close + name.length + 2;
    if (close - open.end > MAX_BLOCK_CHARS) continue;
    blocks.push({ source: xml.slice(open.end + 1, close), lower: lower.slice(open.end + 1, close) });
  }
  return blocks;
}

const NAME_CHAR = /[A-Za-z:-]/;

const SPACE = /\s/;

function skipSpace(source: string, from: number): number {
  let at = from;
  while (at < source.length && SPACE.test(source.charAt(at))) at += 1;
  return at;
}

function nameEnd(source: string, from: number): number {
  let at = from;
  while (at < source.length && NAME_CHAR.test(source.charAt(at))) at += 1;
  return at;
}

export function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  let at = 0;
  while (at < source.length) {
    const end = nameEnd(source, at);
    if (end === at) {
      at += 1;
      continue;
    }
    const equals = skipSpace(source, end);
    const quote = source.charAt(equals) === "=" ? source.charAt(skipSpace(source, equals + 1)) : "";
    if (quote !== '"' && quote !== "'") {
      at = end;
      continue;
    }
    const valueStart = skipSpace(source, equals + 1) + 1;
    const close = source.indexOf(quote, valueStart);
    if (close === -1) break;
    const name = source.slice(at, end).toLowerCase();
    if (!found.has(name)) found.set(name, decodeEntities(source.slice(valueStart, close)));
    at = close + 1;
  }
  return found;
}

function resolveHttp(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || !URL.canParse(trimmed, base)) return null;
  const url = new URL(trimmed, base);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}

function entryLink(block: Block, base: string): string | null {
  let textual: string | null = null;
  let at = 0;
  for (let seen = 0; seen < 50; seen += 1) {
    const element = elementAt(block, "link", at);
    if (element === null) break;
    at = element.after;
    const attrs = attributes(element.attrs);
    const href = attrs.get("href");
    if (href !== undefined) {
      const rel = attrs.get("rel");
      if (rel === undefined || rel.toLowerCase() === "alternate") return resolveHttp(href, base);
      continue;
    }
    if (textual === null && element.inner !== null) textual = collapse(decodeEntities(unwrapCdata(element.inner)));
  }
  return textual === null ? null : resolveHttp(textual, base);
}

function entryDate(block: Block): string | null {
  const raw = firstTag(block, ["pubdate", "published", "updated", "dc:date"]);
  if (raw === null) return null;
  const parsed = Date.parse(collapse(decodeEntities(unwrapCdata(raw))));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function entryId(block: Block, url: string): string {
  const raw = firstTag(block, ["guid", "id"]);
  const id = raw === null ? "" : collapse(decodeEntities(unwrapCdata(raw)));
  return id === "" ? url : id;
}

function toItem(block: Block, base: string): FeedItem | null {
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

export function parseFeed(xml: string, base: string, options: ParseFeedOptions): FeedItem[] | null {
  if (!isFeedDocument(xml)) return null;
  const cutoff = options.now.getTime() - MAX_ITEM_AGE_DAYS * DAY_MS;
  const items: FeedItem[] = [];
  for (const block of entryBlocks(xml, options.scan ?? { blocksVisited: 0, charsScanned: 0 })) {
    const item = toItem(block, base);
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
