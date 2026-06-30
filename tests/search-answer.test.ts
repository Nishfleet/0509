import { describe, expect, it } from "vitest";

import { buildSearchAnswer } from "~/lib/search-answer";
import type { AdRecord, SearchResponse } from "~/lib/types";

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
    countries: input.countries ?? ["India"],
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
      summary: "These are related ad results, not verified website matches. Use them for leads, not proof.",
      note: "Landing-page signals are not captured on these matches yet.",
    });
    expect(answer.facts).toContainEqual({
      label: "Broader matches",
      value: "1",
      detail: "Related advertiser/text candidates",
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
      note: "This is not proof that the competitor is inactive; it only means this search did not verify a connected ad.",
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
      title: "Live search is temporarily unavailable",
      summary: "Fresh competitor checks are delayed and no recent results are available for this search.",
      note: "Commercial discovery degraded; no cached results are available.",
    });
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
      }),
      displayDomain: "boat-lifestyle.com",
      isDomainSearch: true,
      isBroaderScope: false,
    });

    expect(answer).toMatchObject({
      state: "verified",
      note: "Landing-page signals are missing, so treat the ad creative as the current proof.",
    });
    expect(answer.facts).toContainEqual({
      label: "Landing-page signal",
      value: "0/1",
      detail: "Not captured yet; use the ad cards as creative proof only",
    });
  });
});
