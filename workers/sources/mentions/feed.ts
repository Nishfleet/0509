import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";

const NOT_A_FEED = new Set(["Unrecognized feed format", "The XML document is not well-formed"]);

function rootElementIsFeed(xml: string): boolean {
	let i = 0;
	if (xml.charCodeAt(0) === 0xfeff) i = 1;
	while (xml[i] === " " || xml[i] === "\n" || xml[i] === "\r" || xml[i] === "\t") i += 1;
	if (xml.startsWith("<?", i)) {
		const end = xml.indexOf("?>", i);
		if (end < 0) return false;
		i = end + 2;
		while (xml[i] === " " || xml[i] === "\n" || xml[i] === "\r" || xml[i] === "\t") i += 1;
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
