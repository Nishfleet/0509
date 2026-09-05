import { describe, expect, it } from "vitest";

import {
  adHasVerifiedDomainLink,
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
  it("counts an ad as the brand's own when it lands on the brand's exact domain (no page ID to disambiguate)", () => {
    const ads = [
      ad({ metaAdId: "a1", advertiser: "Nykaa", landingPageUrl: "https://www.nykaa.com/beauty" }),
      ad({ metaAdId: "a2", advertiser: "Nykaa Fashion", landingPageUrl: "https://nykaa.com/fashion" }),
    ];
    expect(countBrandOwnedAds(ads, "nykaa.com")).toBe(2);
    expect(adIsBrandOwned(ads[0]!, "nykaa.com")).toBe(true);
  });

  it("counts an ad as the brand's own when its Meta Page ID matches the brand's own page (issue #1566)", () => {
    const ads = [
      ad({ metaAdId: "a1", advertiser: "Nykaa", advertiserPageId: "111", landingPageUrl: "https://www.nykaa.com/beauty" }),
      ad({ metaAdId: "a2", advertiser: "Nykaa Fashion", advertiserPageId: "111", landingPageUrl: "https://nykaa.com/fashion" }),
    ];
    expect(countBrandOwnedAds(ads, "nykaa.com")).toBe(2);
  });

  it("does NOT count a partner campaign under a different Meta Page ID, even when its name mentions the brand (issue #1566)", () => {
    const ads = [
      ad({ metaAdId: "a1", advertiser: "Nykaa", advertiserPageId: "111", landingPageUrl: "https://www.nykaa.com/beauty" }),
      ad({ metaAdId: "a2", advertiser: "BeautyDeals with Nykaa", advertiserPageId: "222", landingPageUrl: "https://nykaa.com/beauty" }),
    ];
    expect(countBrandOwnedAds(ads, "nykaa.com")).toBe(1);
    expect(adIsBrandOwned(ads[1]!, "nykaa.com")).toBe(false);
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

  it("does not attribute an ad by advertiser-name substring alone (issue #1566)", () => {
    // The old behavior counted any advertiser whose name carried the brand
    // label as a whole word ("Shop on Nykaa", "Nykaa Outlet"). That is
    // exactly the false positive that mis-attributes partner/creator campaigns
    // ("Juan Dussán with Notion"). Name alone is never enough — the ad must
    // land on the brand's own domain or match the brand's Meta Page ID.
    expect(adIsBrandOwned(ad({ metaAdId: "a1", advertiser: "Shop on Nykaa" }), "nykaa.com")).toBe(false);
    expect(adIsBrandOwned(ad({ metaAdId: "a2", advertiser: "Nykaa Outlet" }), "nykaa.com")).toBe(false);
    expect(adIsBrandOwned(ad({ metaAdId: "a3", advertiser: "BeautyDeals Hub" }), "nykaa.com")).toBe(false);
  });

  it("counts only the brand's own ads in a mixed cache", () => {
    const ads = [
      ad({ metaAdId: "a1", advertiser: "Nykaa", landingPageUrl: "https://nykaa.com/x" }),
      ad({ metaAdId: "a2", advertiser: "BeautyDeals Hub", landingPageUrl: "https://nike.com/x" }),
      ad({ metaAdId: "a3", advertiser: "Nykaa", landingPageUrl: "https://nykaa.com/y" }),
    ];
    expect(countBrandOwnedAds(ads, "nykaa.com")).toBe(2);
  });

  it("verifies a brand whose Meta page name is space-separated but lands on the brand's own domain (issue #1428)", () => {
    // Meta advertiser page names are space-separated while the domain label
    // is the concatenated stem. Ownership now rests on the landing domain, so
    // these brand ads landing on their own sites are brand-owned.
    expect(adIsBrandOwned(ad({ advertiser: "Sugar Cosmetics", landingPageUrl: "https://sugarcosmetics.com/x" }), "sugarcosmetics.com")).toBe(true);
    expect(adIsBrandOwned(ad({ advertiser: "Bombay Shaving Company", landingPageUrl: "https://bombayshavingcompany.com/x" }), "bombayshavingcompany.com")).toBe(true);
    expect(adIsBrandOwned(ad({ advertiser: "Ridge Wallet", landingPageUrl: "https://ridgewallet.com/x" }), "ridgewallet.com")).toBe(true);
    expect(adIsBrandOwned(ad({ advertiser: "H&M", landingPageUrl: "https://hm.com/x" }), "hm.com")).toBe(true);
  });

  it("does not over-match a name that merely mentions the brand (issue #1428 precision)", () => {
    // These ads land on nike.com (the helper default), not the brand domain,
    // and carry no page ID, so they are never the brand's own.
    expect(adIsBrandOwned(ad({ advertiser: "Nykaam" }), "nykaa.com")).toBe(false);
    expect(adIsBrandOwned(ad({ advertiser: "Vrindasurii with H&M" }), "hm.com")).toBe(false);
    expect(adIsBrandOwned(ad({ advertiser: "Ridge Wallet Reseller" }), "ridgewallet.com")).toBe(false);
    expect(adIsBrandOwned(ad({ advertiser: "BeautyDeals Hub" }), "sugarcosmetics.com")).toBe(false);
  });

  it("counts an ad as the brand's own when it lands on the brand's regional domain, even if the Meta page name does not fold to the stem (issue #1428)", () => {
    // Ridge Wallet's Meta advertiser page is "The Ridge" — it does not fold to
    // "ridgewallet", so the name checks miss it. But the ads land on the
    // brand's own regional domains (ridgewallet.ca / .eu / .co.uk), which only
    // the brand controls. An ad sending traffic to the brand's own regional
    // site IS the brand's own ad — the same evidence adHasVerifiedDomainLink
    // already trusts for the "links to" claim.
    expect(
      adIsBrandOwned(
        ad({ advertiser: "The Ridge", landingPageUrl: "https://www.ridgewallet.ca/products/wallet" }),
        "ridgewallet.com",
      ),
    ).toBe(true);
    expect(
      adIsBrandOwned(
        ad({ advertiser: "Ridge EU", landingPageUrl: "https://ridgewallet.eu/shop" }),
        "ridgewallet.com",
      ),
    ).toBe(true);
    expect(
      adIsBrandOwned(
        ad({ advertiser: "Ridge UK", landingPageUrl: "https://ridgewallet.co.uk/buy" }),
        "ridgewallet.com",
      ),
    ).toBe(true);
    // A regional landing repairs a pre-classified cache row whose domainMatch
    // is still unverified, without needing a recrawl.
    expect(
      adIsBrandOwned(
        ad({
          advertiser: "The Ridge",
          landingPageUrl: "https://ridgewallet.ca/",
          domainMatch: {
            level: "unverified_provider_candidate",
            reason: "Returned by the Meta source; website connection not verified",
            matchedDomain: null,
          },
        }),
        "ridgewallet.com",
      ),
    ).toBe(true);
  });

  it("does not count a regional-domain landing as brand-owned when the landing stem is a different brand (issue #1428 precision)", () => {
    // allbirds.co.uk is a regional property of allbirds.com, NOT of nykaa.com.
    // An unrelated advertiser landing there must not flip to brand-owned for a
    // different brand's page.
    expect(
      adIsBrandOwned(
        ad({ advertiser: "BeautyDeals Hub", landingPageUrl: "https://www.allbirds.co.uk/x" }),
        "nykaa.com",
      ),
    ).toBe(false);
    // A same-suffix landing on the brand's exact domain with no page ID IS the
    // brand's own under issue #1566 (exact normalized domain on the landing
    // page) — ownership no longer rests on the advertiser name.
    expect(
      adIsBrandOwned(
        ad({ advertiser: "BeautyDeals Hub", landingPageUrl: "https://nykaa.com/x" }),
        "nykaa.com",
      ),
    ).toBe(true);
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

describe("adHasVerifiedDomainLink — regional brand properties", () => {
  it("counts an allbirds.co.uk landing as a verified link to allbirds.com even when the cache still labels it unverified", () => {
    const cached = ad({
      landingPageUrl: "https://www.allbirds.co.uk/products/womens-dasher",
      domainMatch: {
        level: "unverified_provider_candidate",
        reason: "Returned by the Meta source; website connection not verified",
        matchedDomain: null,
      },
    });
    expect(adHasVerifiedDomainLink(cached, "allbirds.com")).toBe(true);
  });

  it("counts a mamaearth.in landing as a verified link to mamaearth.com even when the cache still labels it unverified", () => {
    const cached = ad({
      landingPageUrl: "https://mamaearth.in/product/ubtan-face-wash",
      domainMatch: {
        level: "unverified_text_candidate",
        reason: "Mentions “mamaearth” in ad text only",
        matchedDomain: null,
      },
    });
    expect(adHasVerifiedDomainLink(cached, "mamaearth.com")).toBe(true);
  });

  it("still refuses a text-mention with no landing page", () => {
    const cached = ad({
      landingPageUrl: null,
      domainMatch: undefined,
    });
    expect(adHasVerifiedDomainLink(cached, "allbirds.com")).toBe(false);
  });
});
