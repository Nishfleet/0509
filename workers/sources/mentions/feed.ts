import { extractFromXml } from "@extractus/feed-extractor";

export function parseFeedEntries(
	xml: string,
	getExtraEntryFields?: (entryData: Record<string, unknown>) => Record<string, unknown>,
) {
	return extractFromXml(xml, getExtraEntryFields ? { getExtraEntryFields } : {}).entries ?? [];
}
