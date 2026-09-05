import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AdRecord, SearchResponse } from "~/lib/types";

// Issue #1440 — `/search?q=<major-brand>` must label the brand's own rows
// verified (or at least likely), not blanket `Unmatched`, matching
// `/ads/:domain`. The bare keyword is resolved to the real registrable domain
// the returned rows land on; `resolveWebsiteIdentity` is mocked to return
// null so no network fetch happens in the unit test (the landing-page
// hostname match is the load-bearing signal and needs no site-identity
// aliases). The search must still never break on an identity fetch failure.
vi.mock("~/lib/website-identity.server", () => ({
  resolveWebsiteIdentity: vi.fn().mockResolvedValue(null),
}));

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Nike",
    body: "Just do it.",
    previewHeadline: "Shop Nike",
    previewSubhead: "New arrivals",
    hook: "Shop Nike",
    offer: "Sale",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["United States"],
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

describe("issue #1440 — bare major-brand keyword resolves to brand domain", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("labels a brand's own rows verified when they land on the brand domain", async () => {
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );
    const { domainMatchTier } = await import("~/lib/search-domain-match");

    const raw = result([
      ad({
        metaAdId: "nike-1",
        advertiser: "Nike",
        landingPageUrl: "https://www.nike.com/shoes",
      }),
      ad({
        metaAdId: "nike-2",
        advertiser: "Nike Official",
        landingPageUrl: "https://www.nike.com/running",
      }),
      ad({
        metaAdId: "reseller-1",
        advertiser: "Sneaker Exchange",
        landingPageUrl: "https://resell.example.com/deals",
      }),
    ]);

    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "nike",
      "exact",
    );

    const verifiedOrHigher = tiered.ads.filter((row) =>
      ["verified", "likely"].includes(domainMatchTier(row.domainMatch?.level)),
    );
    // The brand's own rows (landing on nike.com) are verified, so the free
    // preview no longer disclaims its subject on every row.
    expect(verifiedOrHigher.length).toBeGreaterThan(0);
    expect(tiered.verifiedCount ?? 0).toBeGreaterThan(0);
  });

  it("leaves a bare keyword unmatched when no row lands on a matching domain", async () => {
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );
    const { domainMatchTier } = await import("~/lib/search-domain-match");

    const raw = result([
      ad({
        metaAdId: "goat-1",
        advertiser: "GOAT Mouth Tape",
        landingPageUrl: "https://sleep.example.com/tape",
      }),
      ad({ metaAdId: "goat-2", advertiser: "Sneaker reseller" }),
    ]);

    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "goat",
      "exact",
    );

    for (const row of tiered.ads) {
      expect(domainMatchTier(row.domainMatch?.level)).toBe("unmatched");
    }
    expect(tiered.unmatchedCount).toBe(2);
    expect(tiered.verifiedCount ?? 0).toBe(0);
  });
});
