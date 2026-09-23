import { z } from "zod";

export interface NameSources {
	ldOrganizationName: string | null;
	ogSiteName: string | null;
	title: string | null;
}

export interface BrandName {
	name: string;
	source: "ld_organization" | "og_site_name" | "title" | "wikidata";
}

const wikidataSearchSchema = z.object({
	search: z.array(z.object({ label: z.string() })),
});

const PAGE_SOURCES = [
	["ld_organization", "ldOrganizationName"],
	["og_site_name", "ogSiteName"],
	["title", "title"],
] as const;

export async function resolveBrandName(
	sources: NameSources,
	wikidataSearchTerm: string | null,
): Promise<BrandName | null> {
	for (const [source, key] of PAGE_SOURCES) {
		const value = sources[key];
		if (value?.trim()) {
			return { name: value.trim(), source };
		}
	}

	const term = wikidataSearchTerm?.trim();
	if (!term) return null;

	try {
		const res = await fetch(
			"https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=1&search=" +
				encodeURIComponent(term),
			{ method: "GET", signal: AbortSignal.timeout(8000) },
		);
		if (!res.ok) return null;
		const parsed = wikidataSearchSchema.safeParse(await res.json());
		if (!parsed.success) return null;
		const label = parsed.data.search[0]?.label.trim();
		if (!label) return null;
		return { name: label, source: "wikidata" };
	} catch {
		return null;
	}
}
