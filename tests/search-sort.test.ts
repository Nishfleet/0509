import { describe, expect, it } from "vitest";

import {
  ANONYMOUS_DEFAULT_SEARCH_RESULT_SORT,
  compareAdsActiveFirstThenLongevity,
  compareAdsVerifiedFirstThenActive,
  DEFAULT_SEARCH_RESULT_SORT,
  parseSearchResultSort,
  pickFeaturedProofAd,
  sortAdsForSearchDisplay,
} from "~/lib/search-sort";
import type { AdRecord } from "~/lib/types";

function ad(partial: Partial<AdRecord> & Pick<AdRecord, "metaAdId" | "active">): AdRecord {
  return {
    advertiser: "Brand",
    body: "Body",
    previewHeadline: "Headline",
    previewSubhead: "Sub",
    hook: "Hook",
    offer: "Offer",
    cta: "Shop",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: null,
    adSnapshotUrl: null,
    countries: ["US"],
    platforms: ["Facebook"],
    firstSeenAt: null,
    lastSeenAt: null,
    researchSummary: "Summary",
    source: "meta_library_browser",
    analysisFields: [],
    ...partial,
  };
}

const verifiedMatch = { level: "exact_hostname", reason: "r", matchedDomain: "x.com" };
const likelyMatch = { level: "likely_brand_name", reason: "r", matchedDomain: null };
const unmatchedMatch = { level: "unverified_provider_candidate", reason: "r", matchedDomain: null };

describe("search result sort", () => {
  it("orders active before inactive, then longest-running first", () => {
    const inactiveOld = ad({
      metaAdId: "inactive-old",
      active: false,
      firstSeenAt: "2025-01-01T00:00:00.000Z",
    });
    const activeRecent = ad({
      metaAdId: "active-recent",
      active: true,
      firstSeenAt: "2026-06-01T00:00:00.000Z",
    });
    const activeOld = ad({
      metaAdId: "active-old",
      active: true,
      firstSeenAt: "2025-06-01T00:00:00.000Z",
    });

    const sorted = sortAdsForSearchDisplay([inactiveOld, activeRecent, activeOld], "active_first");
    expect(sorted.map((item) => item.metaAdId)).toEqual([
      "active-old",
      "active-recent",
      "inactive-old",
    ]);
    expect(compareAdsActiveFirstThenLongevity(activeOld, activeRecent)).toBeLessThan(0);
  });

  it("never auto-selects inactive proof when an active ad exists", () => {
    const inactive = ad({
      metaAdId: "inactive-first",
      active: false,
      firstSeenAt: "2024-01-01T00:00:00.000Z",
    });
    const active = ad({
      metaAdId: "active-second",
      active: true,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
    });

    expect(pickFeaturedProofAd([inactive, active])?.metaAdId).toBe("active-second");
    expect(pickFeaturedProofAd([inactive])?.metaAdId).toBe("inactive-first");
  });

  it("defaults anonymous /search to verified_first and keeps signed-in on active_first", () => {
    expect(ANONYMOUS_DEFAULT_SEARCH_RESULT_SORT).toBe("verified_first");
    expect(DEFAULT_SEARCH_RESULT_SORT).toBe("active_first");
  });

  it("parses verified_first and falls back to active_first for unknown values", () => {
    expect(parseSearchResultSort("verified_first")).toBe("verified_first");
    expect(parseSearchResultSort(null)).toBe("active_first");
    expect(parseSearchResultSort("bogus")).toBe("active_first");
  });

  it("sorts every verified row above every Likely row (verified_first)", () => {
    const likelyActive = ad({
      metaAdId: "likely-active",
      active: true,
      firstSeenAt: "2025-01-01T00:00:00.000Z",
      domainMatch: likelyMatch,
    });
    const verifiedInactive = ad({
      metaAdId: "verified-inactive",
      active: false,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      domainMatch: verifiedMatch,
    });
    const unmatchedActive = ad({
      metaAdId: "unmatched-active",
      active: true,
      firstSeenAt: "2025-06-01T00:00:00.000Z",
      domainMatch: unmatchedMatch,
    });

    const sorted = sortAdsForSearchDisplay(
      [likelyActive, verifiedInactive, unmatchedActive],
      "verified_first",
    );
    // Verified first, then likely, then unmatched — even though the verified
    // row is inactive and the likely/unmatched rows are active.
    expect(sorted.map((item) => item.metaAdId)).toEqual([
      "verified-inactive",
      "likely-active",
      "unmatched-active",
    ]);
  });

  it("preserves active-first order within a tier under verified_first", () => {
    const verifiedRecent = ad({
      metaAdId: "verified-recent",
      active: true,
      firstSeenAt: "2026-06-01T00:00:00.000Z",
      domainMatch: verifiedMatch,
    });
    const verifiedOld = ad({
      metaAdId: "verified-old",
      active: true,
      firstSeenAt: "2025-06-01T00:00:00.000Z",
      domainMatch: verifiedMatch,
    });
    const likelyRecent = ad({
      metaAdId: "likely-recent",
      active: true,
      firstSeenAt: "2026-06-01T00:00:00.000Z",
      domainMatch: likelyMatch,
    });

    const sorted = sortAdsForSearchDisplay(
      [likelyRecent, verifiedRecent, verifiedOld],
      "verified_first",
    );
    expect(sorted.map((item) => item.metaAdId)).toEqual([
      "verified-old",
      "verified-recent",
      "likely-recent",
    ]);
  });

  it("leaves legacy rows without domainMatch last and stable under verified_first", () => {
    const legacy = ad({
      metaAdId: "legacy",
      active: true,
      firstSeenAt: "2024-01-01T00:00:00.000Z",
    });
    const verified = ad({
      metaAdId: "verified",
      active: false,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      domainMatch: verifiedMatch,
    });

    expect(
      compareAdsVerifiedFirstThenActive(legacy, verified),
    ).toBeGreaterThan(0);
    expect(
      compareAdsVerifiedFirstThenActive(verified, legacy),
    ).toBeLessThan(0);
  });
});
