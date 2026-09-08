import { describe, expect, it } from "vitest";

import { buildSearchAnswer } from "~/lib/search-answer";
import {
  formatResultTierLabel,
  formatResultTierTail,
  hasResultTierMetadata,
  resolveResultTierCounts,
} from "~/lib/search-display";
import { domainMatchTier } from "~/lib/search-domain-match";
import type { AdRecord, SearchResponse } from "~/lib/types";

/**
 * Issue #1851: the three-tier result model (verified / likely / unmatched)
 * replaces the binary verified/unverified output. The bare dead-end empty
 * card fires ONLY on a genuine 0-candidate row set — a brand whose verified
 * rows the post-filter dropped to zero but still has raw candidates renders
 * those candidates as labelled likely/unmatched rows, not a dead-end.
 *
 * These tests cover the four states the issue names:
 *   1. verified — rows with verified domainMatch levels
 *   2. likely — rows with likely_brand_name, no verified
 *   3. unmatched — rows with unverified provider/text candidates, no verified
 *   4. true-0-candidate — no ads at all, the bare dead-end
 *
 * The #1191 verification bar is NOT widened: confirm is a user-aided promotion
 * of a labelled candidate, not a relaxation of the automatic post-filter. The
 * `resolveVerifiedAdvertiserPageId` path only returns a page ID for verified
 * rows, so likely/unmatched rows never feed automatic verification.
 */
function ad(input: Partial<AdRecord> & { metaAdId: string }): AdRecord {
  return {
    advertiser: input.advertiser ?? "Brand",
    body: input.body ?? "Copy",
    previewHeadline: input.previewHeadline ?? "Headline",
    previewSubhead: input.previewSubhead ?? "Subhead",
    hook: input.hook ?? "Hook",
    offer: input.offer ?? "Offer",
    cta: input.cta ?? "Shop now",
    format: input.format ?? "image",
    languageLabel: input.languageLabel ?? "English",
    destinationType: input.destinationType ?? "website",
    landingPageUrl: input.landingPageUrl ?? null,
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
    ...input,
  } as AdRecord;
}

function response(input: Partial<SearchResponse> = {}): SearchResponse {
  return {
    ads: input.ads ?? [],
    nextCursor: input.nextCursor ?? null,
    source: input.source ?? "meta_library_browser",
    provider: input.provider ?? "meta_library_browser",
    cacheStatus: input.cacheStatus ?? "hit",
    discoveryStatus: input.discoveryStatus ?? "healthy",
    discoveryPartial: input.discoveryPartial ?? false,
    discoverySummary: input.discoverySummary ?? null,
    discoveryFailureClass: input.discoveryFailureClass ?? null,
    discoveryEmptyReason: input.discoveryEmptyReason,
    verifiedCount: input.verifiedCount,
    likelyCount: input.likelyCount,
    unmatchedCount: input.unmatchedCount,
    rawCandidateCount: input.rawCandidateCount,
    broaderCandidateCount: input.broaderCandidateCount,
  };
}

const DOMAIN = "allbirds.com";

describe("search tier model (issue #1851)", () => {
  describe("resolveResultTierCounts", () => {
    it("classifies verified rows from v2 post-filter counts", () => {
      const result = response({
        ads: [
          ad({ metaAdId: "1", domainMatch: { level: "registrable_domain", reason: "", matchedDomain: DOMAIN } }),
          ad({ metaAdId: "2", domainMatch: { level: "exact_hostname", reason: "", matchedDomain: DOMAIN } }),
        ],
        verifiedCount: 2,
        likelyCount: 0,
        unmatchedCount: 0,
      });
      expect(resolveResultTierCounts(result)).toEqual({
        verified: 2,
        likely: 0,
        unmatched: 0,
      });
    });

    it("classifies likely rows (brand-name match, no website link)", () => {
      const result = response({
        ads: [
          ad({ metaAdId: "1", domainMatch: { level: "likely_brand_name", reason: "", matchedDomain: null } }),
          ad({ metaAdId: "2", domainMatch: { level: "likely_brand_name", reason: "", matchedDomain: null } }),
        ],
        verifiedCount: 0,
        likelyCount: 2,
        unmatchedCount: 0,
      });
      expect(resolveResultTierCounts(result)).toEqual({
        verified: 0,
        likely: 2,
        unmatched: 0,
      });
    });

    it("classifies unmatched rows (provider candidates with no brand connection)", () => {
      const result = response({
        ads: [
          ad({ metaAdId: "1", domainMatch: { level: "unverified_provider_candidate", reason: "", matchedDomain: null } }),
          ad({ metaAdId: "2", domainMatch: { level: "unverified_text_candidate", reason: "", matchedDomain: null } }),
        ],
        verifiedCount: 0,
        likelyCount: 0,
        unmatchedCount: 2,
      });
      expect(resolveResultTierCounts(result)).toEqual({
        verified: 0,
        likely: 0,
        unmatched: 2,
      });
    });

    it("returns all zeros for a true 0-candidate result", () => {
      const result = response({
        ads: [],
        discoveryEmptyReason: "no_results",
        verifiedCount: 0,
        likelyCount: 0,
        unmatchedCount: 0,
      });
      expect(resolveResultTierCounts(result)).toEqual({
        verified: 0,
        likely: 0,
        unmatched: 0,
      });
    });
  });

  describe("formatResultTierLabel", () => {
    it("returns null for verified rows (the detail pane states the proof)", () => {
      const verifiedAd = ad({
        metaAdId: "1",
        domainMatch: { level: "registrable_domain", reason: "", matchedDomain: DOMAIN },
      });
      expect(formatResultTierLabel(verifiedAd)).toBeNull();
    });

    it("returns 'Likely' for likely rows", () => {
      const likelyAd = ad({
        metaAdId: "1",
        domainMatch: { level: "likely_brand_name", reason: "", matchedDomain: null },
      });
      expect(formatResultTierLabel(likelyAd)).toBe("Likely");
    });

    it("returns 'Unmatched' for unmatched rows", () => {
      const unmatchedAd = ad({
        metaAdId: "1",
        domainMatch: { level: "unverified_provider_candidate", reason: "", matchedDomain: null },
      });
      expect(formatResultTierLabel(unmatchedAd)).toBe("Unmatched");
    });

    it("returns null for legacy rows without domainMatch metadata", () => {
      const legacyAd = ad({ metaAdId: "1" });
      expect(formatResultTierLabel(legacyAd)).toBeNull();
    });
  });

  describe("formatResultTierTail", () => {
    it("renders the honest tier breakdown when tier metadata is present", () => {
      const result = response({
        ads: [
          ad({ metaAdId: "1", domainMatch: { level: "registrable_domain", reason: "", matchedDomain: DOMAIN } }),
          ad({ metaAdId: "2", domainMatch: { level: "likely_brand_name", reason: "", matchedDomain: null } }),
          ad({ metaAdId: "3", domainMatch: { level: "unverified_provider_candidate", reason: "", matchedDomain: null } }),
        ],
        verifiedCount: 1,
        likelyCount: 1,
        unmatchedCount: 1,
      });
      const tail = formatResultTierTail(result);
      expect(tail).toContain("1 verified");
      expect(tail).toContain("1 likely");
      expect(tail).toContain("1 unmatched");
    });

    it("returns null for legacy results without tier metadata", () => {
      const result = response({ ads: [ad({ metaAdId: "1" })] });
      expect(formatResultTierTail(result)).toBeNull();
    });
  });

  describe("buildSearchAnswer — bare dead-end fires ONLY on genuine 0-candidate", () => {
    it("renders the verified verdict when verified rows exist", () => {
      const result = response({
        ads: [
          ad({ metaAdId: "1", domainMatch: { level: "registrable_domain", reason: "", matchedDomain: DOMAIN } }),
        ],
        verifiedCount: 1,
        likelyCount: 0,
        unmatchedCount: 0,
      });
      const answer = buildSearchAnswer({
        result,
        displayDomain: DOMAIN,
        isDomainSearch: true,
        isBroaderScope: false,
      });
      expect(answer.state).toBe("verified");
      expect(answer.title).toContain("1 verified ad");
    });

    it("renders a tier-named no_verified verdict (NOT the bare dead-end) when likely rows exist", () => {
      const result = response({
        ads: [
          ad({ metaAdId: "1", domainMatch: { level: "likely_brand_name", reason: "", matchedDomain: null } }),
        ],
        verifiedCount: 0,
        likelyCount: 1,
        unmatchedCount: 0,
      });
      const answer = buildSearchAnswer({
        result,
        displayDomain: DOMAIN,
        isDomainSearch: true,
        isBroaderScope: false,
      });
      expect(answer.state).toBe("no_verified");
      // The tier-named title names the likely count, not the bare "No verified
      // ads found" dead-end copy.
      expect(answer.title).not.toContain("No verified ads found");
      expect(answer.summary).toContain("Confirm a likely one");
    });

    it("renders a tier-named no_verified verdict (NOT the bare dead-end) when only unmatched rows exist", () => {
      const result = response({
        ads: [
          ad({ metaAdId: "1", domainMatch: { level: "unverified_provider_candidate", reason: "", matchedDomain: null } }),
        ],
        verifiedCount: 0,
        likelyCount: 0,
        unmatchedCount: 1,
      });
      const answer = buildSearchAnswer({
        result,
        displayDomain: DOMAIN,
        isDomainSearch: true,
        isBroaderScope: false,
      });
      expect(answer.state).toBe("no_verified");
      // Candidates exist, so the title names the tiers — the bare dead-end
      // copy is suppressed.
      expect(answer.title).not.toContain("No verified ads found");
    });

    it("renders the bare dead-end ONLY when zero candidate rows of any tier exist", () => {
      const result = response({
        ads: [],
        discoveryEmptyReason: "no_results",
        verifiedCount: 0,
        likelyCount: 0,
        unmatchedCount: 0,
      });
      const answer = buildSearchAnswer({
        result,
        displayDomain: DOMAIN,
        isDomainSearch: true,
        isBroaderScope: false,
      });
      // This is the ONE state that produces the bare dead-end copy.
      expect(answer.state).toBe("no_verified");
      expect(answer.title).toContain("No verified ads found");
      expect(result.discoveryEmptyReason).toBe("no_results");
    });

    it("does NOT render the bare dead-end when candidates exist but none are verified", () => {
      // The critical assertion: a brand with raw candidates (likely + unmatched)
      // but zero verified rows must NOT produce the bare "No verified ads found"
      // dead-end. The three-tier model surfaces those candidates as labelled
      // rows instead.
      const result = response({
        ads: [
          ad({ metaAdId: "1", domainMatch: { level: "likely_brand_name", reason: "", matchedDomain: null } }),
          ad({ metaAdId: "2", domainMatch: { level: "unverified_provider_candidate", reason: "", matchedDomain: null } }),
        ],
        verifiedCount: 0,
        likelyCount: 1,
        unmatchedCount: 1,
        // discoveryEmptyReason is NOT "no_results" because ads.length > 0.
        discoveryEmptyReason: undefined,
      });
      const answer = buildSearchAnswer({
        result,
        displayDomain: DOMAIN,
        isDomainSearch: true,
        isBroaderScope: false,
      });
      expect(answer.state).toBe("no_verified");
      expect(answer.title).not.toContain("No verified ads found");
      expect(result.discoveryEmptyReason).not.toBe("no_results");
      // The tier counts prove candidates exist below the verification bar.
      const tiers = resolveResultTierCounts(result);
      expect(tiers.likely + tiers.unmatched).toBeGreaterThan(0);
    });
  });

  describe("#1191 verification bar is not widened", () => {
    it("domainMatchTier maps likely and unmatched levels to non-verified tiers", () => {
      // The confirm path promotes a labelled candidate; it does NOT relax the
      // automatic post-filter. The tier mapping is the contract: only verified
      // levels map to "verified".
      expect(domainMatchTier("likely_brand_name")).toBe("likely");
      expect(domainMatchTier("unverified_provider_candidate")).toBe("unmatched");
      expect(domainMatchTier("unverified_text_candidate")).toBe("unmatched");
      expect(domainMatchTier("registrable_domain")).toBe("verified");
      expect(domainMatchTier("exact_hostname")).toBe("verified");
      expect(domainMatchTier(undefined)).toBe("unmatched");
    });

    it("hasResultTierMetadata detects v2 results that carry tier counts", () => {
      const withTiers = response({
        ads: [ad({ metaAdId: "1", domainMatch: { level: "likely_brand_name", reason: "", matchedDomain: null } })],
        verifiedCount: 0,
        likelyCount: 1,
        unmatchedCount: 0,
      });
      expect(hasResultTierMetadata(withTiers)).toBe(true);

      const legacy = response({ ads: [ad({ metaAdId: "1" })] });
      expect(hasResultTierMetadata(legacy)).toBe(false);
    });
  });
});
