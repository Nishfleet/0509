import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";
import { XMLParser } from "fast-xml-parser";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function atomFeed(xml: string): Record<string, unknown> | null {
	const parsed: unknown = new XMLParser({ ignoreAttributes: false }).parse(xml);
	if (!isRecord(parsed) || !Object.hasOwn(parsed, "feed")) return null;
	const feed = parsed.feed;
	return isRecord(feed) ? feed : {};
}

export function entriesFromAtom<T extends Record<string, unknown>>(
	xml: string,
	getExtraEntryFields: (entryData: Record<string, unknown>) => T,
): (FeedEntry & T)[] | null {
	const feed = atomFeed(xml);
	if (feed === null) return null;
	if (!Object.hasOwn(feed, "entry")) return [];
	return parseFeedEntries(xml, getExtraEntryFields);
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
