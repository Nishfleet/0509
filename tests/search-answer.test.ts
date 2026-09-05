import { describe, expect, it } from "vitest";

import { buildSearchAnswer } from "~/lib/search-answer";
import type { AdRecord, LandingPageSnapshotData, SearchResponse } from "~/lib/types";

function capturedLandingPage(input: Partial<LandingPageSnapshotData> = {}): LandingPageSnapshotData {
  return {
    rawUrl: input.rawUrl ?? "https://boat-lifestyle.com/sale",
    canonicalUrl: input.canonicalUrl ?? "https://boat-lifestyle.com/sale",
    rawHeadline: input.rawHeadline ?? "Bass bhi. Battery bhi.",
    normalizedHeadline: input.normalizedHeadline ?? "bass bhi. battery bhi.",
    normalizedHeadlineHash: input.normalizedHeadlineHash ?? "fnv1a-4d52f63b",
    captureMethod: input.captureMethod ?? "manual",
    capturedAt: input.capturedAt ?? "2026-03-28T09:00:00.000Z",
  };
}

function ad(input: Partial<AdRecord> = {}): AdRecord {
  return {
    metaAdId: input.metaAdId ?? "meta-1",
    advertiser: input.advertiser ?? "Boat Lifestyle",
    body: input.body ?? "Bass bhi, battery bhi.",
    previewHeadline: input.previewHeadline ?? "Bass bhi. Battery bhi.",
    previewSubhead: input.previewSubhead ?? "Launch pricing",
    hook: input.hook ?? "Bass bhi. Battery bhi.",
    offer: input.offer ?? "Launch pricing",
    cta: input.cta ?? "Shop now",
    format: input.format ?? "image",
    languageLabel: input.languageLabel ?? "English",
    destinationType: input.destinationType ?? "website",
    landingPageUrl: "landingPageUrl" in input ? input.landingPageUrl ?? null : "https://boat-lifestyle.com/sale",
    adSnapshotUrl: input.adSnapshotUrl ?? "https://cdn.example.com/ad.png",
    countries: input.countries ?? ["all"],
    platforms: input.platforms ?? ["Instagram"],
    firstSeenAt: input.firstSeenAt ?? null,
    lastSeenAt: input.lastSeenAt ?? null,
    active: input.active ?? true,
    researchSummary: input.researchSummary ?? "Summary",
    source: input.source ?? "meta_library_browser",
    analysisFields: input.analysisFields ?? [],
    landingPage: input.landingPage ?? null,
    domainMatch: input.domainMatch,
  };
}

function response(input: Partial<SearchResponse> = {}): SearchResponse {
  return {
    ads: input.ads ?? [],
    nextCursor: input.nextCursor ?? null,
    source: input.source ?? "meta_library_browser",
    provider: input.provider ?? "meta_library_browser",
    cacheStatus: input.cacheStatus ?? "miss",
    discoveryStatus: input.discoveryStatus ?? "healthy",
    discoveryPartial: input.discoveryPartial ?? false,
    discoverySummary: input.discoverySummary ?? null,
    discoveryFailureClass: input.discoveryFailureClass ?? null,
    verifiedCount: input.verifiedCount,
    broaderCandidateCount: input.broaderCandidateCount,
  };
}

describe("buildSearchAnswer", () => {
  it("answers exact domain searches with verified match copy", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [
          ad({
            landingPage: capturedLandingPage(),
            domainMatch: {
              level: "landing_page_domain",
              reason: "Landing page matches boat-lifestyle.com",
              matchedDomain: "boat-lifestyle.com",
            },
          }),
        ],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "verified",
      title: "1 verified ad linked to boat-lifestyle.com",
      summary: "These ads are connected to the competitor website through advertiser or landing-page evidence.",
      note: null,
    });
    expect(answer.facts).toContainEqual({
      label: "Landing-page signal",
      value: "1/1",
      detail: "Captured from ad destinations when available",
    });
  });

  it("does not count destination URLs alone as captured landing-page signals", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "verified",
      note: "Landing-page signals are missing, so treat the ad creative as the current signal.",
    });
    expect(answer.facts).toContainEqual({
      label: "Landing-page signal",
      value: "0/1",
      detail: "Not captured yet; use the ad cards as creative signals only",
    });
  });

  it("counts only captured landing-page snapshots across mixed results", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [
          ad({
            metaAdId: "meta-captured",
            landingPage: capturedLandingPage(),
            domainMatch: {
              level: "verified_advertiser_domain",
              reason: "Advertiser matches boat-lifestyle.com",
              matchedDomain: "boat-lifestyle.com",
            },
          }),
          ad({ metaAdId: "meta-url-only" }),
        ],
        verifiedCount: 2,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "verified",
      note: null,
    });
    expect(answer.facts).toContainEqual({
      label: "Landing-page signal",
      value: "1/2",
      detail: "Captured from ad destinations when available",
    });
  });

  it.each(["hit", "stale"] as const)(
    "keeps the Meta source label neutral for %s cache results",
    (cacheStatus) => {
      const answer = buildSearchAnswer({
        result: response({
          ads: [ad()],
          verifiedCount: 1,
          cacheStatus,
        }),
        displayDomain: "boat-lifestyle.com",
        isDomainSearch: true,
        isBroaderScope: false,
      });

      expect(answer.facts).toContainEqual(expect.objectContaining({
        label: "Source",
        value: "Meta Ad Library visual source",
        detail: cacheStatus === "hit" ? "Showing recent cached results" : "Showing older cached results",
      }));
    },
  );

  it("does not present broader matches as verified proof", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad({ landingPageUrl: null })],
        broaderCandidateCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: true,
    });

    expect(answer).toMatchObject({
      state: "broader",
      title: "1 broader match for boat-lifestyle.com",
      summary: "These are related ad results, not verified website matches. Use them for leads, not confirmed evidence.",
      note: "Landing-page signals are not captured on these matches yet.",
    });
    expect(answer.facts).toContainEqual({
      label: "Related matches",
      value: "1",
      detail: "Unverified advertiser/text candidates",
    });
  });

  it("explains exact domain searches with no verified ads", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [],
        broaderCandidateCount: 3,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "no_verified",
      title: "No verified ads found for boat-lifestyle.com",
      summary: "We could not confirm ads whose advertiser or landing page is connected to this website.",
      note: "This is not evidence that the competitor is inactive; it only means this search did not verify a connected ad.",
    });
  });

  it.each(["degraded", "cache_only"] as const)(
    "treats %s without cached ads as an unavailable live check",
    (discoveryStatus) => {
      const answer = buildSearchAnswer({
        result: response({
          ads: [],
          cacheStatus: discoveryStatus === "cache_only" ? "stale" : "miss",
          discoveryStatus,
          discoverySummary: "Fresh checks are delayed and no cached results are available.",
          discoveryFailureClass: "timeout",
        }),
        displayDomain: "boat-lifestyle.com",
        isDomainSearch: true,
        isBroaderScope: false,
      });

      expect(answer).toMatchObject({
        state: "degraded",
        title: "Search preview is temporarily unavailable",
        summary: "Fresh competitor checks are delayed and no recent results are available for this search.",
      });
      expect(answer.facts).toContainEqual({
        label: "Fresh ads",
        value: "Delayed",
        detail: "Delayed",
      });
    },
  );

  it("does not present a zero-result partial search as complete", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [],
        broaderCandidateCount: 3,
        nextCursor: "cursor-2",
        discoveryPartial: true,
        discoverySummary: "Some additional Meta results could not be loaded.",
        discoveryFailureClass: "browser_unavailable",
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "degraded",
      title: "Search results are partial",
      summary:
        "3 related candidates are available on the partial page. Additional results could not be loaded, so this is not a complete no-ads result.",
      note: "Retry to continue loading the remaining results.",
    });
    expect(answer.facts).toContainEqual({
      label: "Related candidates loaded so far",
      value: "3",
      detail: "Available to review separately without a verified website claim",
    });
  });

  it("does not present a non-empty partial search as complete", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
        nextCursor: "cursor-2",
        discoveryPartial: true,
        discoverySummary: "Some additional Meta results could not be loaded.",
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "degraded",
      title: "1 verified ad loaded so far for boat-lifestyle.com",
    });
    expect(answer.facts).toContainEqual({
      label: "Verified ads loaded so far",
      value: "1",
      detail: "Connected to this domain on the partial page",
    });
    expect(answer.summary).toContain("this page is partial");
    expect(answer.note).toContain("Retry to continue loading the remaining results.");
  });

  it("qualifies broader matches when the result page is partial", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad({ landingPageUrl: null })],
        verifiedCount: 0,
        broaderCandidateCount: 1,
        nextCursor: "cursor-2",
        discoveryPartial: true,
        discoverySummary: "Some additional Meta results could not be loaded.",
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: true,
    });

    expect(answer).toMatchObject({
      state: "degraded",
      title: "1 broader match loaded so far for boat-lifestyle.com",
      summary: expect.stringContaining("this page is partial"),
      note: expect.stringContaining("Retry to continue loading the remaining results."),
    });
    expect(answer.facts).toContainEqual({
      label: "Related matches loaded so far",
      value: "1",
      detail: "Unverified advertiser/text candidates on the partial page",
    });
  });

  it("qualifies zero verified evidence when a non-empty result page is partial", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 0,
        nextCursor: "cursor-2",
        discoveryPartial: true,
        discoverySummary: "Some additional Meta results could not be loaded.",
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "degraded",
      title: "No verified ads in the results loaded so far for boat-lifestyle.com",
    });
    expect(answer.facts).toContainEqual({
      label: "Verified ads loaded so far",
      value: "0",
      detail: "Exact website match on the partial page",
    });
    expect(answer.title).not.toContain("No verified ads found");
  });

  it("does not turn an explicit zero verified count into proof", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 0,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "no_verified",
      title: "No verified ads for boat-lifestyle.com — 1 unmatched candidate",
      summary: "These ads matched your search but we couldn't verify they belong to the brand. Confirm a likely one before treating it as proof.",
      note: "This is not evidence that the competitor is inactive; it only means this search did not verify a connected ad.",
    });
    expect(answer.facts).toContainEqual({
      label: "Verified ads",
      value: "0",
      detail: "Exact website match only",
    });
    expect(answer.facts).toContainEqual({
      label: "Likely matches",
      value: "0",
      detail: "No brand-name matches",
    });
    expect(answer.facts).toContainEqual({
      label: "Unmatched candidates",
      value: "1",
      detail: "Returned by the source with no brand connection",
    });
  });

  it("labels likely brand-name matches in the no-verified verdict (BET 2)", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [
          ad({
            metaAdId: "likely-1",
            advertiser: "Boat",
            landingPageUrl: null,
            domainMatch: {
              level: "likely_brand_name",
              reason: "Advertiser name matches boat-lifestyle.com",
              matchedDomain: "boat-lifestyle.com",
            },
          }),
          ad({
            metaAdId: "unmatched-1",
            advertiser: "Reseller",
            landingPageUrl: null,
            domainMatch: {
              level: "unverified_provider_candidate",
              reason: "Returned by the Meta source; website connection not verified",
              matchedDomain: null,
            },
          }),
        ],
        verifiedCount: 0,
        likelyCount: 1,
        unmatchedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "no_verified",
      title: "No verified ads for boat-lifestyle.com — 1 likely match, 1 unmatched candidate",
      summary: "These ads matched your search but we couldn't verify they belong to the brand. Confirm a likely one before treating it as proof.",
    });
    expect(answer.facts).toContainEqual({
      label: "Likely matches",
      value: "1",
      detail: "Advertiser name fits this brand; website link not captured",
    });
    expect(answer.facts).toContainEqual({
      label: "Unmatched candidates",
      value: "1",
      detail: "Returned by the source with no brand connection",
    });
  });

  it("keeps returned exact-domain ads unverified when no proof count or domain match exists", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "no_verified",
      title: "No verified ads for boat-lifestyle.com — 1 unmatched candidate",
      summary: "These ads matched your search but we couldn't verify they belong to the brand. Confirm a likely one before treating it as proof.",
    });
  });

  it("can derive verified proof from domain-match metadata", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [
          ad({
            domainMatch: {
              level: "registrable_domain",
              reason: "Landing page matches boat-lifestyle.com",
              matchedDomain: "boat-lifestyle.com",
            },
          }),
        ],
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "verified",
      title: "1 verified ad linked to boat-lifestyle.com",
    });
  });

  it("surfaces degraded live search without inventing results", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [],
        discoveryStatus: "degraded",
        discoverySummary: "Commercial discovery degraded; no cached results are available.",
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "degraded",
      title: "Search preview is temporarily unavailable",
      summary: "Fresh competitor checks are delayed and no recent results are available for this search.",
			// Internal jargon must never leak to the customer-facing note.
			note: "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.",
    });
		expect(answer.note).not.toMatch(/commercial discovery|degraded|cached/i);
    expect(answer.facts).toContainEqual({
      label: "Fresh ads",
      value: "Delayed",
      detail: "Delayed",
    });
  });

  it("warns when returned ads do not include landing-page signals", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad({ landingPageUrl: null, landingPage: null })],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "verified",
      note: "Landing-page signals are missing, so treat the ad creative as the current signal.",
    });
    expect(answer.facts).toContainEqual({
      label: "Landing-page signal",
      value: "0/1",
      detail: "Not captured yet; use the ad cards as creative signals only",
    });
  });
});

describe("buildSearchAnswer market scope", () => {
  it("names the searched country in verified verdicts", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "India",
    });

    expect(answer.title).toBe(
      "1 verified ad linked to boat-lifestyle.com in India",
    );
  });

  it("keeps the all-countries view unscoped in verified verdicts", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "all",
    });

    expect(answer.title).toBe(
      "1 verified ad linked to boat-lifestyle.com",
    );
  });

  it("names the market in no-verified verdicts and keeps the all view unscoped", () => {
    const india = buildSearchAnswer({
      result: response({
        ads: [],
        broaderCandidateCount: 2,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "India",
    });
    const all = buildSearchAnswer({
      result: response({
        ads: [],
        broaderCandidateCount: 2,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "all",
    });

    expect(india.title).toBe(
      "No verified ads found for boat-lifestyle.com in India",
    );
    expect(all.title).toBe(
      "No verified ads found for boat-lifestyle.com",
    );
  });

  it("does not let the all view contradict a specific-country view", () => {
    const all = buildSearchAnswer({
      result: response({
        ads: [],
        broaderCandidateCount: 0,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "all",
    });
    const india = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "India",
    });

    expect(all.title).toBe("No verified ads found for boat-lifestyle.com");
    expect(all.title).not.toContain("across all countries");
    expect(india.title).toBe(
      "1 verified ad linked to boat-lifestyle.com in India",
    );
  });

  it("names the market in broader-match verdicts", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad({ landingPageUrl: null })],
        broaderCandidateCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: true,
      country: "India",
    });

    expect(answer.title).toBe(
      "1 broader match for boat-lifestyle.com in India",
    );
  });

  it("names the market in empty keyword verdicts", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [],
      }),
      displayDomain: null,
      isDomainSearch: false,
      isBroaderScope: false,
      country: "India",
    });

    expect(answer.title).toBe("No ads found for this competitor in India");
  });

  it("names the market in partial-page verdicts", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
        nextCursor: "cursor-2",
        discoveryPartial: true,
        discoverySummary: "Some additional Meta results could not be loaded.",
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "India",
    });

    expect(answer.title).toBe(
      "1 verified ad loaded so far for boat-lifestyle.com in India",
    );
  });

  it("keeps the unscoped copy when no country is provided", () => {
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer.title).toBe("1 verified ad linked to boat-lifestyle.com");
  });

  it("canonicalizes ISO-2 and alias country inputs through the catalog", () => {
    // The resolver already accepts ISO-2 codes and aliases (usa, uk, uae),
    // so the customer-facing phrase must match the market the search
    // actually ran in, not the raw URL input.
    const iso = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "IN",
    });
    const alias = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "usa",
    });

    expect(iso.title).toBe(
      "1 verified ad linked to boat-lifestyle.com in India",
    );
    expect(alias.title).toBe(
      "1 verified ad linked to boat-lifestyle.com in United States",
    );
  });

  it("keeps demo verdicts unscoped even when a country filter is set", () => {
    // Demo/sample matches deliberately ignore the country filter (the
    // resolver matches every demo ad against every market), so labelling
    // a demo verdict "in United States" for India-authored samples would
    // falsely imply country-specific evidence.
    const answer = buildSearchAnswer({
      result: response({
        ads: [ad()],
        verifiedCount: 1,
        source: "demo",
        provider: "demo",
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
      country: "United States",
    });

    expect(answer.title).toBe("1 verified ad linked to boat-lifestyle.com");
  });

  // BET 2 — goat.com mandatory regression. A bare `?q=goat` keyword search
  // returns the thegoatco.au mouth-tape ad (an unrelated AU brand whose name
  // and copy contain the stem "goat"). The verdict must NOT label those ads
  // as verified; it must call them unverified keyword matches and offer a
  // next-action link to a verified goat.com search.
  describe("keyword verdict — goat.com wrong-brand wall", () => {
    const goatMouthTapeAds = (): AdRecord[] => [
      ad({
        metaAdId: "goat-mouth-tape",
        advertiser: "The GOAT",
        body: "THE NEW GOAT MOUTH TAPE IS HERE. Kirsten K., Verified Buyer",
        previewHeadline: "THE NEW GOAT MOUTH TAPE IS HERE",
        landingPageUrl: "https://thegoatco.au/products/mouth-tape",
        countries: ["Australia"],
      }),
    ];

    it("labels keyword matches as unverified, not as 'N ads found'", () => {
      const answer = buildSearchAnswer({
        result: response({ ads: goatMouthTapeAds() }),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "goat",
        country: "all",
      });

      expect(answer.state).toBe("keyword");
      expect(answer.title).toContain("unverified keyword match");
      expect(answer.title).toContain("goat");
      expect(answer.title).not.toContain("verified ad");
      expect(answer.title).not.toMatch(/^\d+ ad[s]? found$/);
    });

    it("reports zero verified ads and names the keyword match count", () => {
      const answer = buildSearchAnswer({
        result: response({ ads: goatMouthTapeAds() }),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "goat",
        country: "all",
      });

      const verifiedFact = answer.facts.find((f) => f.label === "Verified ads");
      const keywordFact = answer.facts.find((f) => f.label === "Keyword matches");
      expect(verifiedFact?.value).toBe("0");
      expect(keywordFact?.value).toBe("1");
    });

    it("offers a next-action link to a verified goat.com search", () => {
      const answer = buildSearchAnswer({
        result: response({ ads: goatMouthTapeAds() }),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "goat",
        country: "all",
      });

      expect(answer.nextAction).not.toBeNull();
      expect(answer.nextAction?.label).toContain("goat.com");
      expect(answer.nextAction?.href).toContain("website=goat.com");
    });

    it("preserves the searched country in the next-action href", () => {
      const answer = buildSearchAnswer({
        result: response({ ads: goatMouthTapeAds() }),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "goat",
        country: "Australia",
      });

      expect(answer.nextAction?.href).toContain("country=Australia");
      expect(answer.nextAction?.href).toContain("website=goat.com");
    });

    it("does not offer a next-action guess for multi-word keyword queries", () => {
      const answer = buildSearchAnswer({
        result: response({ ads: [ad({ advertiser: "Goat Sneakers" })] }),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "goat sneakers",
        country: "all",
      });

      expect(answer.state).toBe("keyword");
      expect(answer.nextAction).toBeNull();
    });

    it("still names the market in the keyword verdict title", () => {
      const answer = buildSearchAnswer({
        result: response({ ads: goatMouthTapeAds() }),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "goat",
        country: "India",
      });

      expect(answer.title).toContain("in India");
    });

    it("does not fire for a domain search (goat.com with ?website=)", () => {
      const answer = buildSearchAnswer({
        result: response({ ads: goatMouthTapeAds(), verifiedCount: 0 }),
        displayDomain: "goat.com",
        isDomainSearch: true,
        isBroaderScope: false,
        query: "goat.com",
        country: "all",
      });

      // Domain search with 0 verified → no_verified state, not keyword.
      // BET 2 (issue 1482): candidates exist, so the headline names the
      // tiers instead of the "No verified ads found" dead-end copy.
      expect(answer.state).toBe("no_verified");
      expect(answer.title).toContain("No verified ads for goat.com —");
      expect(answer.nextAction).toBeNull();
    });
  });

  // Issue #1452 — the keyword verdict must be count-honest. When the v2
  // post-filter attached tier labels and at least one row resolved
  // verified/likely (q=oura via the brand fallback, q=allbirds via landing
  // domains), the headline states the verified/likely/unmatched counts from
  // the payload instead of a stale "N unverified keyword matches" string
  // that contradicts the tier-labelled rows below it. Legacy results (no
  // tier metadata) and all-unmatched results keep the goat.com wall copy.
  describe("keyword verdict — count-honest headline when tiers resolved (#1452)", () => {
    const ouraRows = (): AdRecord[] => [
      ad({
        metaAdId: "oura-1",
        advertiser: "ŌURA",
        landingPageUrl: "https://ouraring.com/store",
        domainMatch: { level: "verified_alias", reason: "Landing page matches ouraring.com, a product site for oura.com", matchedDomain: "ouraring.com" },
      }),
      ad({
        metaAdId: "oura-2",
        advertiser: "ŌURA",
        landingPageUrl: "https://ouraring.com/rim",
        domainMatch: { level: "verified_alias", reason: "Landing page matches ouraring.com, a product site for oura.com", matchedDomain: "ouraring.com" },
      }),
      ad({
        metaAdId: "oura-3",
        advertiser: "Some Seller",
        landingPageUrl: null,
        domainMatch: { level: "unverified_provider_candidate", reason: "Returned for “oura” by the Meta source", matchedDomain: null },
      }),
    ];

    const tieredResult = () => ({
      ...response({ ads: ouraRows() }),
      searchIntent: "text" as const,
      verifiedCount: 2,
      likelyCount: 0,
      unmatchedCount: 1,
    });

    it("states the verified/likely/unmatched counts in the title", () => {
      const answer = buildSearchAnswer({
        result: tieredResult(),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "oura",
        country: "all",
      });

      expect(answer.title).toContain("2 verified");
      expect(answer.title).toContain("0 likely");
      expect(answer.title).toContain("1 unmatched");
      expect(answer.title).toContain("oura");
      expect(answer.title).not.toContain("unverified keyword match");
    });

    it("carries the real tier values into the facts, not a hardcoded 0", () => {
      const answer = buildSearchAnswer({
        result: tieredResult(),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "oura",
        country: "all",
      });

      const verifiedFact = answer.facts.find((f) => f.label === "Verified ads");
      const likelyFact = answer.facts.find((f) => f.label === "Likely matches");
      const unmatchedFact = answer.facts.find((f) => f.label === "Unmatched candidates");
      expect(verifiedFact?.value).toBe("2");
      expect(likelyFact?.value).toBe("0");
      expect(unmatchedFact?.value).toBe("1");
    });

    it("still names the market in the count-honest title", () => {
      const answer = buildSearchAnswer({
        result: tieredResult(),
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "oura",
        country: "India",
      });

      expect(answer.title).toContain("in India");
    });

    it("keeps the unverified wall copy when tiers exist but nothing resolved", () => {
      // A v2 result where every row is labelled but none connected to the
      // brand (the goat.com case once tier labels land) must keep the
      // goat.com wall — "0 verified" rows are never headlined as resolved.
      const allUnmatched = (): AdRecord[] => [
        ad({
          metaAdId: "goat-mouth-tape",
          advertiser: "The GOAT",
          landingPageUrl: "https://thegoatco.au/products/mouth-tape",
          domainMatch: { level: "unverified_provider_candidate", reason: "Returned for “goat” by the Meta source", matchedDomain: null },
        }),
      ];
      const answer = buildSearchAnswer({
        result: {
          ...response({ ads: allUnmatched() }),
          searchIntent: "text" as const,
          verifiedCount: 0,
          likelyCount: 0,
          unmatchedCount: 1,
        },
        displayDomain: null,
        isDomainSearch: false,
        isBroaderScope: false,
        query: "goat",
        country: "all",
      });

      expect(answer.title).toContain("unverified keyword match");
      expect(answer.title).not.toContain("verified, ");
    });
  });
});
