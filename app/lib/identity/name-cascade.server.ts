import { z } from "zod";

import { cappedJson, fetchOutbound } from "../fetch/outbound.server";
import { CRAWLER_USER_AGENT } from "../fetch/robots.server";

export interface NameSources {
  ldOrganizationName: string | null;
  ogSiteName: string | null;
  title: string | null;
}

export interface BrandName {
  name: string;
  source: "ld_organization" | "og_site_name" | "title" | "wikidata";
}

const MAX_JSON_BYTES = 1024 * 1024;

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
    const res = await fetchOutbound(
      "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=1&search=" +
        encodeURIComponent(term),
      { headers: { "user-agent": CRAWLER_USER_AGENT }, schemes: ["https:"] },
    );
    if (!res.ok) {
      console.error(JSON.stringify({ event: "identity.wikidata_failed", error: `status ${String(res.status)}` }));
      return null;
    }
    const parsed = wikidataSearchSchema.safeParse(await cappedJson(res, MAX_JSON_BYTES));
    if (!parsed.success) return null;
    const label = parsed.data.search[0]?.label.trim();
    if (!label) return null;
    return { name: label, source: "wikidata" };
  } catch (error) {
    console.error(
      JSON.stringify({ event: "identity.wikidata_failed", error: error instanceof Error ? error.name : typeof error }),
    );
    return null;
  }
}
