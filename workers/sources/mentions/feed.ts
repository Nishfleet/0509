import { extractFromXml } from "@extractus/feed-extractor";

export function parseFeedEntries(xml: string) {
	return extractFromXml(xml).entries ?? [];
}
