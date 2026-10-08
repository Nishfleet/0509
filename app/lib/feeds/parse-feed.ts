import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";

import { sha256Hex } from "../sha256";
import { closeTruncated } from "./close-truncated";

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

export interface ParseFeedOptions {
  now: Date;
}

export const MAX_FEED_ITEMS = 20;

const MAX_ITEM_AGE_DAYS = 30;

const MAX_TITLE_CHARS = 200;

const MAX_EXCERPT_CHARS = 200;

const DAY_MS = 86_400_000;

const FEED_ROOT = /<(rss|feed|rdf:RDF)[\s>]/i;

const NOT_A_FEED = new Set([
  "Unrecognized feed format",
  "The XML document is not well-formed",
  "External entities are not supported",
]);
const XML_HEAD_BYTES = 4_096;

function text(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number") return String(raw);
  if (raw === null || typeof raw !== "object") return "";
  const node = raw as Record<string, unknown>;
  for (const key of ["#text", "_cdata", "$t", "_text"]) {
    const value = node[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cut(value: string, limit: number): string {
  const clean = collapse(value);
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

function resolveHttp(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "" || !URL.canParse(trimmed, base)) return null;
  const url = new URL(trimmed, base);
  url.hash = "";
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}

function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

function isNode(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function firstText(nodes: readonly unknown[], key: string): string {
  for (const node of nodes) {
    if (node === undefined) continue;
    const value = typeof node === "object" ? text((node as Record<string, unknown>)[key]) : text(node);
    if (value !== "") return value;
  }
  return "";
}

function entryLink(raw: Record<string, unknown>, fallback: string, base: string): string | null {
  const links = asList(raw.link);
  const hrefOf = (link: unknown): string => {
    if (!isNode(link)) return text(link);
    const href = text(link["@_href"]);
    return href !== "" ? href : text(link);
  };
  const relOf = (link: unknown): string => {
    if (!isNode(link)) return "";
    const rel = link["@_rel"];
    return typeof rel === "string" ? rel.toLowerCase() : "";
  };
  const alternate = links.find((link) => {
    const rel = relOf(link);
    return rel === "" || rel.split(/\s+/).includes("alternate");
  });
  const href = [hrefOf(alternate), ...links.map(hrefOf), fallback].find((value) => value !== "") ?? "";
  return resolveHttp(href, base);
}

function entryDate(raw: Record<string, unknown>, published: string): string | null {
  if (published !== "") return published;
  const parsed = Date.parse(firstText(asList(raw["dc:date"]), "#text"));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function unmarkup(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/[<>]/g, "");
}

function entryId(raw: Record<string, unknown>, url: string, parsedId: string): string {
  const declared = firstText([raw.guid, raw.id], "#text");
  return declared === "" ? url : parsedId;
}

function toItem(entry: FeedEntry & { raw: Record<string, unknown> }, base: string): FeedItem | null {
  const url = entryLink(entry.raw, entry.link ?? "", base);
  if (url === null) return null;
  const title = cut(unmarkup(entry.title ?? ""), MAX_TITLE_CHARS);
  if (title === "") return null;
  const rawExcerpt = text(entry.raw.summary) !== "" ? text(entry.raw.summary) : text(entry.raw.description);
  const excerpt = entry.description ?? rawExcerpt;
  return {
    id: entryId(entry.raw, url, entry.id),
    title,
    url,
    excerpt: excerpt === "" ? null : cut(excerpt, MAX_EXCERPT_CHARS),
    publishedAt: entryDate(entry.raw, entry.published ?? ""),
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

function extract(xml: string, base: string): FeedEntry[] | null {
  try {
    return (
      extractFromXml(xml, {
        baseUrl: base,
        descriptionMaxLen: 0,
        getExtraEntryFields: (raw) => ({ raw }),
      }).entries ?? []
    );
  } catch (error) {
    if (!(error instanceof Error) || !NOT_A_FEED.has(error.message)) throw error;
    return null;
  }
}

function extractEntries(xml: string, base: string): FeedEntry[] | null {
  const entries = extract(xml, base);
  if (entries !== null) return entries;
  const closed = closeTruncated(xml);
  return closed === null ? null : extract(closed, base);
}

export function isFeedDocument(xml: string): boolean {
  return FEED_ROOT.test(xml.slice(0, XML_HEAD_BYTES));
}

export function parseFeed(xml: string, base: string, options: ParseFeedOptions): FeedItem[] | null {
  if (!isFeedDocument(xml)) return null;
  const cutoff = options.now.getTime() - MAX_ITEM_AGE_DAYS * DAY_MS;
  const entries = extractEntries(xml, base);
  if (entries === null) return null;
  const items: FeedItem[] = [];
  for (const entry of entries) {
    const item = toItem(entry as FeedEntry & { raw: Record<string, unknown> }, base);
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

export async function keyItems(items: readonly FeedItem[]): Promise<KeyedFeedItem[]> {
  return Promise.all(items.map(async (item) => ({ ...item, key: await sha256Hex(item.id) })));
}

export async function hashItemKeys(items: readonly KeyedFeedItem[]): Promise<string> {
  return sha256Hex(
    items
      .map((item) => item.key)
      .sort()
      .join("\n"),
  );
}
