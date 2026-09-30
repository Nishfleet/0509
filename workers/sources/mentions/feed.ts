import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";

const NOT_A_FEED = new Set(["Unrecognized feed format", "The XML document is not well-formed"]);

const XML_WHITESPACE = new Set([" ", "\n", "\r", "\t"]);

function skipWhitespace(xml: string, from: number): number {
  let i = from;
  while (XML_WHITESPACE.has(xml[i] ?? "")) i += 1;
  return i;
}

function rootElementIsFeed(xml: string): boolean {
  let i = skipWhitespace(xml, xml.charCodeAt(0) === 0xfeff ? 1 : 0);
  if (xml.startsWith("<?", i)) {
    const end = xml.indexOf("?>", i);
    if (end < 0) return false;
    i = skipWhitespace(xml, end + 2);
  }
  return /^<feed(?:\s|\/?>)/.test(xml.slice(i));
}

export function readAtomEntries(
  xml: string,
  getExtraEntryFields: (entryData: Record<string, unknown>) => Record<string, unknown>,
): FeedEntry[] | null {
  try {
    return extractFromXml(xml, { getExtraEntryFields }).entries ?? [];
  } catch (error) {
    if (!(error instanceof Error) || !NOT_A_FEED.has(error.message)) throw error;
    if (error.message === "Unrecognized feed format" && rootElementIsFeed(xml)) {
      return [];
    }
    return null;
  }
}

export function parseFeedEntries<T extends Record<string, unknown>>(
  xml: string,
  getExtraEntryFields: (entryData: Record<string, unknown>) => T,
): (FeedEntry & T)[];
export function parseFeedEntries(xml: string): FeedEntry[];
export function parseFeedEntries(
  xml: string,
  getExtraEntryFields?: (entryData: Record<string, unknown>) => Record<string, unknown>,
): FeedEntry[] {
  return extractFromXml(xml, getExtraEntryFields ? { getExtraEntryFields } : {}).entries ?? [];
}
