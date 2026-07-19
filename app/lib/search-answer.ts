import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import type { SearchResponse } from "~/lib/types";

export type SearchAnswerState =
  | "verified"
  | "broader"
  | "no_verified"
  | "degraded"
  | "empty"
  | "idle";

/**
 * AI-generated "What to steal" takeaway rendered inside the search answer
 * panel. Always exactly 3 bullets; produced and validated server-side by
 * search-steal-summary.server.ts (absent entirely when validation fails).
 */
export interface SearchStealSummary {
  bullets: string[];
}

export interface SearchAnswer {
  state: SearchAnswerState;
  title: string;
  summary: string;
  facts: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
  note: string | null;
}

export function buildSearchAnswer(input: {
  result: SearchResponse;
  displayDomain: string | null;
  isDomainSearch: boolean;
  isBroaderScope: boolean;
}): SearchAnswer {
  const result = input.result;
  const ads = result.ads ?? [];
  const adCount = ads.length;
  const domain = input.displayDomain?.trim() || null;
  const landingPageCount = ads.filter((ad) => Boolean(ad.landingPage || ad.landingPageUrl)).length;
  const verifiedCount = resolveVerifiedCount(result);
  const broaderCount = Math.max(
    0,
    Math.floor(result.broaderCandidateCount ?? result.rawCandidateCount ?? (input.isBroaderScope ? adCount : 0)),
  );
  const sourceLabel = formatSearchSource(result);
  const landingFact = {
    label: "Landing-page signal",
    value: `${landingPageCount}/${adCount}`,
    detail: adCount === 0
      ? "No ads to inspect yet"
      : landingPageCount > 0
        ? "Captured from ad destinations when available"
        : "Not captured yet; use the ad cards as creative signals only",
  };

  if (isDelayedSearchStatus(result.discoveryStatus) && adCount === 0) {
    return {
      state: "degraded",
      title: "Search preview is temporarily unavailable",
      summary: "Fresh competitor checks are delayed and no recent results are available for this search.",
      facts: [
        { label: "Fresh ads", value: "Delayed", detail: sourceLabel },
        landingFact,
      ],
			note:
				customerDiscoverySummary(result.discoverySummary) ??
				"Try again shortly or track this competitor so the next sweep keeps checking.",
    };
  }

  if (adCount === 0 && input.isDomainSearch && domain && !input.isBroaderScope) {
    return {
      state: "no_verified",
      title: `No verified ads found for ${domain}`,
      summary: "We could not confirm ads whose advertiser or landing page is connected to this website.",
      facts: [
        { label: "Verified ads", value: "0", detail: "Exact website match only" },
        {
          label: "Related candidates",
          value: String(broaderCount),
          detail: broaderCount > 0
            ? "Available to review separately without a verified website claim"
            : result.source === "demo"
              ? "The sample source has no related candidates"
              : "The Meta source returned no related candidates",
        },
        { label: "Source", value: sourceLabel, detail: formatCacheDetail(result.cacheStatus) },
      ],
      note: "This is not evidence that the competitor is inactive; it only means this search did not verify a connected ad.",
    };
  }

  if (adCount === 0) {
    return {
      state: result.discoveryStatus === "disabled" ? "idle" : "empty",
      title: result.discoveryStatus === "disabled" ? "Enter a competitor website" : "No ads found for this competitor",
      summary: result.discoveryStatus === "disabled"
        ? "Paste one competitor site to see whether Five to Nine can verify currently available ads."
        : "The search completed without returning visible ads.",
      facts: [
        { label: "Ads found", value: "0", detail: sourceLabel },
      ],
			note: customerDiscoverySummary(result.discoverySummary),
    };
  }

  if (input.isBroaderScope && domain) {
    const relatedOnlyCount = Math.max(0, adCount - verifiedCount);
    return {
      state: "broader",
      title: verifiedCount > 0
        ? `${verifiedCount} verified and ${relatedOnlyCount} related match${relatedOnlyCount === 1 ? "" : "es"} for ${domain}`
        : `${adCount} broader match${adCount === 1 ? "" : "es"} for ${domain}`,
      summary: verifiedCount > 0
        ? "Verified matches are connected to the website; related matches remain leads until their source can be confirmed."
        : "These are related ad results, not verified website matches. Use them for leads, not confirmed evidence.",
      facts: [
        { label: "Verified matches", value: String(verifiedCount), detail: "Connected to this website" },
        { label: "Related matches", value: String(relatedOnlyCount), detail: "Unverified advertiser/text candidates" },
        landingFact,
        { label: "Source", value: sourceLabel, detail: formatCacheDetail(result.cacheStatus) },
      ],
      note: landingPageCount === 0 ? "Landing-page signals are not captured on these matches yet." : null,
    };
  }

  if (input.isDomainSearch && domain && verifiedCount === 0) {
    return {
      state: "no_verified",
      title: `No verified ads found for ${domain}`,
      summary: "Returned ads were not connected to this website through advertiser or landing-page evidence.",
      facts: [
        { label: "Verified ads", value: "0", detail: "Exact website match only" },
        { label: "Returned ads", value: String(adCount), detail: "Review as unverified candidates only" },
        landingFact,
      ],
      note: "This is not evidence that the competitor is inactive; it only means this search did not verify a connected ad.",
    };
  }

  if (input.isDomainSearch && domain) {
    return {
      state: "verified",
      title: `${verifiedCount} verified ad${verifiedCount === 1 ? "" : "s"} linked to ${domain}`,
      summary: "These ads are connected to the competitor website through advertiser or landing-page evidence.",
      facts: [
        { label: "Verified ads", value: String(verifiedCount), detail: "Connected to this domain" },
        landingFact,
        { label: "Source", value: sourceLabel, detail: formatCacheDetail(result.cacheStatus) },
      ],
      note: landingPageCount === 0 ? "Landing-page signals are missing, so treat the ad creative as the current signal." : null,
    };
  }

  return {
    state: "verified",
    title: `${adCount} ad${adCount === 1 ? "" : "s"} found`,
    summary: "Review the ad cards and selected ad detail to decide what is worth saving or tracking.",
    facts: [
      { label: "Ads found", value: String(adCount), detail: sourceLabel },
      landingFact,
    ],
    note: landingPageCount === 0 ? "Landing-page signals are not captured yet." : null,
  };
}

function resolveVerifiedCount(result: SearchResponse) {
  if (typeof result.verifiedCount === "number") {
    return Math.max(0, Math.floor(result.verifiedCount));
  }

  return result.ads.filter((ad) => isVerifiedDomainMatchLevel(ad.domainMatch?.level)).length;
}

function isVerifiedDomainMatchLevel(level: string | null | undefined) {
  return level === "exact_hostname" ||
    level === "registrable_domain" ||
    level === "verified_advertiser_domain" ||
    level === "verified_alias" ||
    level === "verified_entity";
}

function formatSearchSource(result: SearchResponse) {
  if (isDelayedSearchStatus(result.discoveryStatus)) {
    return "Delayed";
  }
  if (result.provider === "meta_library_browser" || result.source === "meta_library_browser") {
    return "Meta Ad Library visual source";
  }
  if (result.provider === "meta_api" || result.source === "meta_api") {
    return "Alternate Meta check";
  }
  if (result.source === "demo") {
    return "Sample data";
  }
  return "Search result";
}

function isDelayedSearchStatus(status: SearchResponse["discoveryStatus"]) {
  return status === "degraded" || status === "cache_only";
}

function formatCacheDetail(cacheStatus: SearchResponse["cacheStatus"]) {
  switch (cacheStatus) {
    case "hit":
      return "Showing recent cached results";
    case "stale":
      return "Showing older cached results";
    case "miss":
      return "Fresh result";
    default:
      return "Availability depends on source response";
  }
}
