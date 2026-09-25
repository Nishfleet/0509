import { extractFromXml } from "@extractus/feed-extractor";
import type { FeedEntry } from "@extractus/feed-extractor";

const NOT_A_FEED = new Set(["Unrecognized feed format", "The XML document is not well-formed"]);

function documentElementLocalName(xml: string): string | null {
	let i = 0;
	const n = xml.length;
	while (i < n && xml.charCodeAt(i) === 0xfeff) i += 1;
	while (i < n) {
		const c = xml[i];
		if (c === " " || c === "\n" || c === "\r" || c === "\t") {
			i += 1;
			continue;
		}
		if (xml.startsWith("<?", i)) {
			const end = xml.indexOf("?>", i);
			if (end < 0) return null;
			i = end + 2;
			continue;
		}
		if (xml.startsWith("<!--", i)) {
			const end = xml.indexOf("-->", i);
			if (end < 0) return null;
			i = end + 3;
			continue;
		}
		if (xml.startsWith("<!", i)) {
			const end = xml.indexOf(">", i);
			if (end < 0) return null;
			i = end + 1;
			continue;
		}
		if (c !== "<") return null;
		i += 1;
		const start = i;
		while (i < n) {
			const ch = xml.charCodeAt(i);
			const nameChar =
				(ch >= 65 && ch <= 90) ||
				(ch >= 97 && ch <= 122) ||
				(ch >= 48 && ch <= 57) ||
				ch === 95 ||
				ch === 58 ||
				ch === 45 ||
				ch === 46;
			if (!nameChar) break;
			i += 1;
		}
		const name = xml.slice(start, i);
		const colon = name.lastIndexOf(":");
		const local = colon === -1 ? name : name.slice(colon + 1);
		return local.length > 0 ? local : null;
	}
	return null;
}

export function readAtomEntries<T extends Record<string, unknown>>(
	xml: string,
	getExtraEntryFields: (entryData: Record<string, unknown>) => T,
): (FeedEntry & T)[] | null {
	try {
		return extractFromXml(xml, { getExtraEntryFields }).entries ?? [];
	} catch (error) {
		if (!(error instanceof Error) || !NOT_A_FEED.has(error.message)) throw error;
		if (error.message === "Unrecognized feed format" && documentElementLocalName(xml) === "feed") {
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
