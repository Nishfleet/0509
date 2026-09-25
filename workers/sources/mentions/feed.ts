import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";
import { XMLParser } from "fast-xml-parser";

function atomDocument(xml: string): boolean {
	const parsed: unknown = new XMLParser({ ignoreAttributes: false }).parse(xml);
	return typeof parsed === "object" && parsed !== null && Object.hasOwn(parsed, "feed");
}

export function entriesFromAtom<T extends Record<string, unknown>>(
	xml: string,
	getExtraEntryFields: (entryData: Record<string, unknown>) => T,
): (FeedEntry & T)[] | null {
	if (!atomDocument(xml)) return null;
	try {
		return parseFeedEntries(xml, getExtraEntryFields);
	} catch (error) {
		if (error instanceof Error && error.message === "Unrecognized feed format") return [];
		throw error;
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
