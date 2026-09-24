import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";

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
