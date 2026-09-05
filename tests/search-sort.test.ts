import { describe, expect, it } from "vitest";

import {
  compareAdsActiveFirstThenLongevity,
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
});
