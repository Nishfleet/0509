import { afterEach, describe, expect, it, vi } from "vitest";

import { MetaApiError, filterAdsBySearchFilters, searchAds } from "~/lib/meta-api.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import type { AdRecord } from "~/lib/types";

const query = normalizeSavedQuery("keyword", {
  query: "cod",
  country: "India",
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildAd(overrides: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: "ad-1",
    advertiser: "Allbirds",
    body: "Sustainable wool runners.",
    previewHeadline: "Meet the Wool Runner",
    previewSubhead: "",
    hook: "Meet the Wool Runner",
    offer: "Free shipping",
    cta: "Shop now",
    format: "image",
    languageLabel: "English",
    destinationType: "website",
    landingPageUrl: "https://www.allbirds.com/products/mens-wool-runners",
    adSnapshotUrl: "https://www.facebook.com/ads/library/?id=ad-1",
    countries: ["US"],
    platforms: ["Instagram"],
    firstSeenAt: null,
    lastSeenAt: null,
    active: true,
    researchSummary: "fixture",
    source: "meta_library_browser",
    analysisFields: [],
    tags: [],
    ...overrides,
  };
}

describe("filterAdsBySearchFilters — advertiser (domain) matching contract", () => {
  const domainQuery = normalizeSavedQuery("advertiser", {
    query: "allbirds.com",
    country: "US",
  });

  it("keeps a card whose advertiser name + landing domain both match the queried domain", () => {
    const ads = [buildAd()];
    expect(filterAdsBySearchFilters(ads, domainQuery)).toHaveLength(1);
  });

  it("keeps a card with a BLANK advertiser but a matching landing domain (logged-out grid)", () => {
    const ads = [buildAd({ metaAdId: "blank", advertiser: "" })];
    const result = filterAdsBySearchFilters(ads, domainQuery);
    expect(result.map((ad) => ad.metaAdId)).toEqual(["blank"]);
  });

  it("keeps a card whose landing domain matches via an l.facebook.com redirect snapshot", () => {
    const ads = [
      buildAd({
        metaAdId: "redirect",
        advertiser: "",
        landingPageUrl: null,
        adSnapshotUrl:
          "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.allbirds.com%2Fsale",
      }),
    ];
    expect(filterAdsBySearchFilters(ads, domainQuery)).toHaveLength(1);
  });

  it("rejects a junk card: unrelated advertiser AND non-matching landing domain", () => {
    const ads = [
      buildAd({
        metaAdId: "junk",
        advertiser: "Random Dropshipper",
        landingPageUrl: "https://scamsite.example/checkout",
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=junk",
      }),
    ];
    expect(filterAdsBySearchFilters(ads, domainQuery)).toEqual([]);
  });

  it("rejects a blank-advertiser card with no landing domain and no identity", () => {
    const ads = [
      buildAd({
        metaAdId: "no-proof",
        advertiser: "",
        landingPageUrl: null,
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=no-proof",
      }),
    ];
    expect(filterAdsBySearchFilters(ads, domainQuery)).toEqual([]);
  });

  it("matches a bare brand-token query against the landing-domain stem", () => {
    const brandQuery = normalizeSavedQuery("advertiser", {
      query: "allbirds",
      country: "US",
    });
    const ads = [buildAd({ advertiser: "" })];
    expect(filterAdsBySearchFilters(ads, brandQuery)).toHaveLength(1);
  });

  it("keeps a blank-advertiser card via page-id identity when the query is page-scoped", () => {
    const pageScoped = normalizeSavedQuery("advertiser", {
      query: "allbirds.com",
      country: "US",
      pageId: "1234567890",
    });
    const ads = [
      buildAd({
        metaAdId: "identity",
        advertiser: "",
        landingPageUrl: null,
        adSnapshotUrl: "https://www.facebook.com/ads/library/?id=identity",
        advertiserPageId: "1234567890",
      }),
    ];
    expect(filterAdsBySearchFilters(ads, pageScoped)).toHaveLength(1);
  });
});

describe("searchAds", () => {
  it("throws a provider error when no Meta token is configured", async () => {
    await expect(
      searchAds({} as never, query, null),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it("throws on live Meta errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 190,
            message: "Bad token",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await expect(
      searchAds({ META_AD_LIBRARY_TOKEN: "token" } as never, query, null),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it("uses ad_reached_countries for live Meta queries", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await searchAds({ META_AD_LIBRARY_TOKEN: "token" } as never, query, null);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("ad_reached_countries")).toBe("IN");
    expect(requestUrl.searchParams.get("country")).toBeNull();
  });

  it("treats malformed successful Meta JSON as a provider error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{not-json", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    await expect(
      searchAds({ META_AD_LIBRARY_TOKEN: "token" } as never, query, null),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it("never splits an emoji when deriving the preview subhead from a long body", async () => {
    // Units 0..118 are filler, unit 119 is the HIGH half of 🌟 (U+1F31F): a
    // plain body.slice(0, 120) would orphan it and the subhead would render
    // the U+FFFD replacement character on /search.
    const body = "a".repeat(115) + "cod" + "a" + "🌟 more copy after the cut";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "ad-emoji-boundary",
              page_name: "Nykaa",
              ad_creative_bodies: [body],
              ad_creative_link_titles: [],
              ad_creative_link_descriptions: [],
              ad_creative_link_captions: [],
              publisher_platforms: ["facebook"],
              ad_reached_countries: ["IN"],
              ad_active_status: "ACTIVE",
              ad_delivery_start_time: null,
              ad_snapshot_url: null,
              media_type: "IMAGE",
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const result = await searchAds(
      { META_AD_LIBRARY_TOKEN: "token" } as never,
      query,
      null,
    );

    expect(result.ads).toHaveLength(1);
    expect(result.ads[0]!.previewSubhead).toBe("a".repeat(115) + "cod" + "a");
    expect(/[\uD800-\uDFFF]/.test(result.ads[0]!.previewSubhead)).toBe(false);
    expect(result.ads[0]!.previewSubhead.includes("\uFFFD")).toBe(false);
  });
});
