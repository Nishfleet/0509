import { describe, expect, it, vi } from "vitest";

import type { AdRecord, SearchResponse } from "~/lib/types";

// `buildSearchV2Context` calls `resolveWebsiteIdentity`, which fetches the
// brand site over the network. The keyword-tier helper must never break a
// search on a network hiccup, so the domain-like keyword path is exercised
// with the identity resolver mocked to reject — proving the fallback labels
// every row instead of throwing.
vi.mock("~/lib/website-identity.server", () => ({
  resolveWebsiteIdentity: vi
    .fn()
    .mockRejectedValue(new Error("network unavailable in test")),
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

describe("keyword search domain-match tier labels (BET 2, issue #1433)", () => {
  it("labels every bare-keyword row as unmatched with a domainMatch object", async () => {
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );
    const { formatResultTierLabel } = await import("~/lib/search-display");
    const { domainMatchTier } = await import("~/lib/search-domain-match");

    const raw = result([
      ad({ metaAdId: "goat-1", advertiser: "GOAT Mouth Tape", body: "Mouth tape" }),
      ad({ metaAdId: "goat-2", advertiser: "Sneaker reseller" }),
    ]);

    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "goat",
      "exact",
    );

    // Every row carries a domainMatch object — the v1 pipeline left these
    // absent, so result-row.tsx rendered no tier word.
    for (const row of tiered.ads) {
      expect(row.domainMatch).toBeDefined();
      expect(domainMatchTier(row.domainMatch?.level)).toBe("unmatched");
      // The display helper turns the level into the customer-facing word.
      expect(formatResultTierLabel(row)).toBe("Unmatched");
    }
    expect(tiered).toMatchObject({
      verifiedCount: 0,
      likelyCount: 0,
      unmatchedCount: 2,
      searchIntent: "text",
    });
  });

  it("falls back to unmatched labelling when a domain-like keyword cannot resolve identity", async () => {
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );

    const raw = result([
      ad({ metaAdId: "notion-1", advertiser: "Notion", landingPageUrl: "https://notion.so/x" }),
      ad({ metaAdId: "notion-2", advertiser: "Notion Labs" }),
    ]);

    // `notion.so` parses as a domain intent, but resolveWebsiteIdentity is
    // mocked to reject. The helper must not throw — it labels every row
    // unmatched so the search still renders.
    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      raw,
      "notion.so",
      "exact",
    );

    expect(tiered.ads).toHaveLength(2);
    for (const row of tiered.ads) {
      expect(row.domainMatch).toBeDefined();
      expect(row.domainMatch?.level).toBe("unverified_provider_candidate");
    }
    expect(tiered.unmatchedCount).toBe(2);
    expect(tiered.verifiedCount).toBe(0);
  });

  it("leaves an empty result untouched (no rows to label)", async () => {
    const { attachKeywordSearchDomainMatch } = await import(
      "~/lib/search-execution.server"
    );

    const empty = result([]);
    const tiered = await attachKeywordSearchDomainMatch(
      {} as never,
      empty,
      "goat",
      "exact",
    );
    expect(tiered.ads).toEqual([]);
    // No tier counts are fabricated for an empty result.
    expect(tiered.verifiedCount).toBeUndefined();
  });
});
