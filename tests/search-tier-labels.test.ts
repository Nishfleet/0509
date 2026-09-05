import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, SearchResponse } from "~/lib/types";
import { registrableDomainFromHostname } from "~/lib/search-query";
import type { WebsiteIdentity } from "~/lib/website-identity.server";

// `buildSearchV2Context` calls `resolveWebsiteIdentity`. The six brand-keyword
// tests mock it to return a minimal identity so the v2 classifier runs; the
// final regression test resets it to reject so a non-brand keyword still falls
// back to unmatched.
vi.mock("~/lib/website-identity.server", () => ({
  resolveWebsiteIdentity: vi.fn(),
}));

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Nykaa",
    body: "Beauty sale",
    previewHeadline: "Beauty sale",
    previewSubhead: "Shop now",
    hook: "Beauty sale",
    offer: "Sale",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["India"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

function result(ads: AdRecord[]): SearchResponse {
  return {
    ads,
    nextCursor: null,
    source: "meta_library_browser",
    provider: "meta_library_browser",
    cacheStatus: "miss",
    discoveryStatus: "healthy",
  };
}

function buildIdentity(registrableDomain: string): WebsiteIdentity {
  const label = registrableDomain.split(".")[0];
  return {
    registrableDomain,
    canonicalUrl: `https://${registrableDomain}/`,
    title: label,
    siteName: label,
    aliases: [label],
    domainAliases: [],
    resolvedAt: new Date().toISOString(),
  };
}

const SIX_DOMAINS = [
  {
    query: "allbirds",
    ads: [ad({ metaAdId: "allbirds-1", advertiser: "Allbirds Japan" })],
  },
  {
    query: "notion",
    ads: [
      ad({
        metaAdId: "notion-1",
        advertiser: "Notion",
        landingPageUrl: "https://notion.so/templates",
      }),
    ],
  },
  {
    query: "oura",
    ads: [
      ad({
        metaAdId: "oura-1",
        advertiser: "ŌURA",
        landingPageUrl: "https://ouraring.com/store",
      }),
    ],
  },
  {
    query: "gymshark",
    ads: [
      ad({
        metaAdId: "gymshark-1",
        advertiser: "Gymshark",
        landingPageUrl: "https://www.gymshark.com/shop",
      }),
    ],
  },
  {
    query: "hubspot",
    ads: [
      ad({
        metaAdId: "hubspot-1",
        advertiser: "HubSpot",
        landingPageUrl: "https://www.hubspot.com/products",
      }),
    ],
  },
  {
    query: "mamaearth",
    ads: [
      ad({
        metaAdId: "mamaearth-1",
        advertiser: "Mamaearth",
        landingPageUrl: "https://mamaearth.in/product",
      }),
    ],
  },
];

describe("search.tier.labels", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    vi.mocked(resolveWebsiteIdentity).mockImplementation(async (url) => {
      const parsed = new URL(url);
      const registrable =
        registrableDomainFromHostname(parsed.hostname) ?? parsed.hostname;
      return buildIdentity(registrable);
    });
  });

  it.each(SIX_DOMAINS)(
    "q=$query returns at least one verified or likely row",
    async ({ query, ads }) => {
      const { attachKeywordSearchDomainMatch } = await import(
        "~/lib/search-execution.server"
      );
      const { domainMatchTier } = await import("~/lib/search-domain-match");

      const raw = result(ads);
      const tiered = await attachKeywordSearchDomainMatch(
        {} as never,
        raw,
        query,
        "exact",
      );

      expect(tiered.ads.length).toBeGreaterThan(0);
      const hasTiered = tiered.ads.some((row) => {
        const tier = domainMatchTier(row.domainMatch?.level);
        return tier === "verified" || tier === "likely";
      });
      expect(hasTiered).toBe(true);
    },
  );

  it("still labels an unrelated text keyword as unmatched when identity resolution fails", async () => {
    const { resolveWebsiteIdentity } = await import("~/lib/website-identity.server");
    vi.mocked(resolveWebsiteIdentity).mockRejectedValue(
      new Error("network unavailable in test"),
    );
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );
    const { domainMatchTier } = await import("~/lib/search-domain-match");

    const raw = result([
      ad({ metaAdId: "generic-1", advertiser: "Generic seller", body: "shoes" }),
    ]);
    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "shoes",
      "exact",
    );

    expect(tiered.ads[0].domainMatch).toBeDefined();
    expect(domainMatchTier(tiered.ads[0].domainMatch?.level)).toBe("unmatched");
  });
});
