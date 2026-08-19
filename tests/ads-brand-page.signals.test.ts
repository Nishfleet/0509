import { describe, expect, it } from "vitest";

import {
  adIsBrandOwned,
  brandPageAdLibraryCountryLabel,
  buildBrandChangeFeed,
  computeBrandPageAggressionScore,
  countBrandOwnedAds,
  formatBrandPageCheckedAgo,
  resolveBrandPageFreshness,
} from "~/lib/brand-page.server";
import type { AdRecord } from "~/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-21T12:00:00.000Z");

function isoAgo(ms: number) {
  return new Date(NOW.getTime() - ms).toISOString();
}

function ad(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: overrides.metaAdId ?? "ad-1",
    advertiser: "Nike",
    body: "Run through summer.",
    previewHeadline: "Run through summer with gear that can take the heat.",
    previewSubhead: "",
    hook: "Shop Now",
    offer: "",
    cta: "Shop Now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.nike.com/launch",
    adSnapshotUrl: null,
    countries: ["all"],
    platforms: ["Instagram"],
    firstSeenAt: isoAgo(20 * DAY_MS),
    lastSeenAt: null,
    active: true,
    researchSummary: "",
    source: "meta_library_browser",
    analysisFields: [],
    ...overrides,
  };
}

describe("computeBrandPageAggressionScore", () => {
  it("computes a score from real ad fields when the observed window clears the evidence floor", () => {
    const ads = [
      ad({ metaAdId: "a1", firstSeenAt: isoAgo(60 * DAY_MS), variantCount: 4 }),
      ad({ metaAdId: "a2", firstSeenAt: isoAgo(40 * DAY_MS), variantCount: 2 }),
      ad({ metaAdId: "a3", firstSeenAt: isoAgo(10 * DAY_MS) }),
      ad({ metaAdId: "a4", firstSeenAt: isoAgo(3 * DAY_MS) }),
    ];

    const result = computeBrandPageAggressionScore(ads, NOW);

    expect(result).not.toBeNull();
    expect(result?.windowDays).toBe(60);
    // Components always sum exactly to the displayed score (no hidden weighting).
    const { velocity, testing, freshness, persistence } = result!.components;
    expect(velocity + testing + freshness + persistence).toBe(result!.score);
    expect(result?.adCount).toBe(4);
    expect(result?.activeCount).toBe(4);
    expect(result?.bandLabel).toBeTruthy();
  });

  it("returns null below the 14-day evidence floor rather than scoring thin evidence", () => {
    const ads = [ad({ firstSeenAt: isoAgo(5 * DAY_MS) })];
    expect(computeBrandPageAggressionScore(ads, NOW)).toBeNull();
  });

  it("returns null when no ad carries a first-seen date", () => {
    const ads = [ad({ firstSeenAt: null }), ad({ metaAdId: "a2", firstSeenAt: null })];
    expect(computeBrandPageAggressionScore(ads, NOW)).toBeNull();
  });

  it("returns null for an empty ad set", () => {
    expect(computeBrandPageAggressionScore([], NOW)).toBeNull();
  });
});

describe("buildBrandChangeFeed", () => {
  it("surfaces only ads first observed inside the recent window, newest first", () => {
    const ads = [
      ad({ metaAdId: "old", firstSeenAt: isoAgo(40 * DAY_MS) }),
      ad({ metaAdId: "recent", firstSeenAt: isoAgo(3 * DAY_MS), variantCount: 3 }),
      ad({ metaAdId: "today", firstSeenAt: isoAgo(2 * 60 * 60 * 1000) }),
    ];

    const feed = buildBrandChangeFeed(ads, NOW);

    expect(feed.map((event) => event.id)).toEqual(["today", "recent"]);
    expect(feed[0]?.isToday).toBe(true);
    expect(feed[0]?.dayLabel).toBe("Today");
    expect(feed[1]?.variantCount).toBe(3);
    expect(feed[1]?.why).toContain("3 variants");
    // Every row carries a real capture source.
    expect(feed.every((event) => event.source === "AD LIBRARY")).toBe(true);
  });

  it("returns an empty feed when nothing was newly observed (section hides, no fake card)", () => {
    const ads = [
      ad({ metaAdId: "old-1", firstSeenAt: isoAgo(40 * DAY_MS) }),
      ad({ metaAdId: "old-2", firstSeenAt: isoAgo(90 * DAY_MS) }),
    ];
    expect(buildBrandChangeFeed(ads, NOW)).toEqual([]);
  });

  it("ignores ads without a parseable first-seen date", () => {
    const ads = [ad({ metaAdId: "null-seen", firstSeenAt: null })];
    expect(buildBrandChangeFeed(ads, NOW)).toEqual([]);
  });
});

describe("adIsBrandOwned / countBrandOwnedAds", () => {
  it("counts an ad as the brand's own when the advertiser page carries the brand label", () => {
    const ads = [
      ad({ metaAdId: "a1", advertiser: "Nykaa" }),
      ad({ metaAdId: "a2", advertiser: "Nykaa Fashion" }),
    ];
    expect(countBrandOwnedAds(ads, "nykaa.com")).toBe(2);
    expect(adIsBrandOwned(ads[0]!, "nykaa.com")).toBe(true);
  });

  it("counts an ad whose advertiser page carries the brand's own domain token", () => {
    const ads = [ad({ metaAdId: "a1", advertiser: "Nykaa Beauty — nykaa.com" })];
    expect(countBrandOwnedAds(ads, "nykaa.com")).toBe(1);
  });

  it("trusts v2 advertiser evidence (verified_advertiser_domain / verified_entity) even when the name does not carry the label", () => {
    const verifiedDomain = ad({
      metaAdId: "a1",
      advertiser: "Nykaa Group",
      domainMatch: { level: "verified_advertiser_domain", reason: "Advertiser domain matches nykaa.com", matchedDomain: "nykaa.com" },
    });
    const verifiedEntity = ad({
      metaAdId: "a2",
      advertiser: "Nykaa Beauty Co",
      domainMatch: { level: "verified_entity", reason: "Advertiser is linked to nykaa.com", matchedDomain: "nykaa.com" },
    });
    expect(adIsBrandOwned(verifiedDomain, "nykaa.com")).toBe(true);
    expect(adIsBrandOwned(verifiedEntity, "nykaa.com")).toBe(true);
  });

  it("does not treat landing-page-only match levels as ownership", () => {
    for (const level of ["exact_hostname", "registrable_domain", "verified_alias"]) {
      const candidate = ad({
        metaAdId: `a-${level}`,
        advertiser: "BeautyDeals Hub",
        domainMatch: { level, reason: "Landing page matches nykaa.com", matchedDomain: "nykaa.com" },
      });
      expect(adIsBrandOwned(candidate, "nykaa.com"), level).toBe(false);
    }
  });

  it("never counts other advertisers' creatives as the brand's own", () => {
    const ads = [
      ad({ metaAdId: "a1", advertiser: "BeautyDeals Hub" }),
      ad({ metaAdId: "a2", advertiser: "Outlet City" }),
      ad({ metaAdId: "a3", advertiser: "Nykaam" }), // label only as a substring — no word boundary
      ad({ metaAdId: "a4", advertiser: "" }),
    ];
    expect(countBrandOwnedAds(ads, "nykaa.com")).toBe(0);
    expect(ads.every((candidate) => adIsBrandOwned(candidate, "nykaa.com") === false)).toBe(true);
  });

  it("attributes an advertiser page named with the brand label (official-page convention), matching the ad-card display", () => {
    // Known boundary: a page named "Nykaa Outlet" or "Shop on Nykaa" counts as
    // the brand's because the name carries the label as a whole word — the
    // same convention the ad cards and the search product use. Advertisers
    // with unrelated names never count.
    expect(adIsBrandOwned(ad({ metaAdId: "a1", advertiser: "Shop on Nykaa" }), "nykaa.com")).toBe(true);
    expect(adIsBrandOwned(ad({ metaAdId: "a2", advertiser: "Nykaa Outlet" }), "nykaa.com")).toBe(true);
    expect(adIsBrandOwned(ad({ metaAdId: "a3", advertiser: "BeautyDeals Hub" }), "nykaa.com")).toBe(false);
  });

  it("counts only the brand's own ads in a mixed cache", () => {
    const ads = [
      ad({ metaAdId: "a1", advertiser: "Nykaa" }),
      ad({ metaAdId: "a2", advertiser: "BeautyDeals Hub" }),
      ad({ metaAdId: "a3", advertiser: "Nykaa" }),
    ];
    expect(countBrandOwnedAds(ads, "nykaa.com")).toBe(2);
  });
});

describe("brandPageAdLibraryCountryLabel", () => {
  it("passes a named catalog country through for page copy", () => {
    expect(brandPageAdLibraryCountryLabel("India")).toBe("India");
    expect(brandPageAdLibraryCountryLabel("United States")).toBe("United States");
  });

  it('spells out the "all" (all-countries) view as "all countries" so the copy never implies a single market', () => {
    expect(brandPageAdLibraryCountryLabel("all")).toBe("all countries");
    expect(brandPageAdLibraryCountryLabel("ALL")).toBe("all countries");
  });

  it("returns null when there is no snapshot country", () => {
    expect(brandPageAdLibraryCountryLabel(null)).toBeNull();
    expect(brandPageAdLibraryCountryLabel(undefined)).toBeNull();
    expect(brandPageAdLibraryCountryLabel("  ")).toBeNull();
  });
});

describe("resolveBrandPageFreshness", () => {
  const clock = new Date("2026-08-14T12:00:00.000Z");

  function fetchedAgo(ms: number) {
    return new Date(clock.getTime() - ms).toISOString();
  }

  it("pairs the live claim with the moments-ago stamp from one clock", () => {
    const cases: Array<[number, string, boolean]> = [
      [0, "moments ago", true],
      [119_999, "moments ago", true],
      [120_000, "about 2 minutes ago", false],
      [120_001, "about 2 minutes ago", false],
      [5 * 60_000, "about 5 minutes ago", false],
    ];
    for (const [elapsedMs, checkedAgo, freshForLiveClaim] of cases) {
      const pair = resolveBrandPageFreshness(fetchedAgo(elapsedMs), clock);
      expect(pair).toEqual({ checkedAgo, freshForLiveClaim });
      expect(pair.checkedAgo).toBe(formatBrandPageCheckedAgo(fetchedAgo(elapsedMs), clock));
      expect(pair.freshForLiveClaim).toBe(pair.checkedAgo === "moments ago");
    }
  });

  it("documents the two-clock trap and refuses the disagreeing mix on one clock", () => {
    const fetchedAt = fetchedAgo(119_999);
    const late = new Date(clock.getTime() + 2);
    const earlyPair = resolveBrandPageFreshness(fetchedAt, clock);
    const latePair = resolveBrandPageFreshness(fetchedAt, late);
    expect(earlyPair).toEqual({ checkedAgo: "moments ago", freshForLiveClaim: true });
    expect(latePair).toEqual({ checkedAgo: "about 2 minutes ago", freshForLiveClaim: false });
    // Mixing early-claim + late-stamp is the shipped defect. One helper call
    // never returns that mix.
    expect(earlyPair.freshForLiveClaim && latePair.checkedAgo !== "moments ago").toBe(true);
    for (const now of [clock, late]) {
      const pair = resolveBrandPageFreshness(fetchedAt, now);
      expect(pair.freshForLiveClaim).toBe(pair.checkedAgo === "moments ago");
    }
  });
});
