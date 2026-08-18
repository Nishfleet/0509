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
      title: "No verified ads found for boat-lifestyle.com",
      summary: "Returned ads were not connected to this website through advertiser or landing-page evidence.",
      note: "This is not evidence that the competitor is inactive; it only means this search did not verify a connected ad.",
    });
    expect(answer.facts).toContainEqual({
      label: "Verified ads",
      value: "0",
      detail: "Exact website match only",
    });
    expect(answer.facts).toContainEqual({
      label: "Returned ads",
      value: "1",
      detail: "Review as unverified candidates only",
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
      title: "No verified ads found for boat-lifestyle.com",
      summary: "Returned ads were not connected to this website through advertiser or landing-page evidence.",
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

  it("spells the all-countries view explicitly in verified verdicts", () => {
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
      "1 verified ad linked to boat-lifestyle.com across all countries",
    );
  });

  it("names the market in no-verified verdicts so country filters cannot contradict", () => {
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
      "No verified ads found for boat-lifestyle.com across all countries",
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
});
