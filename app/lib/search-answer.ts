import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import {
  formatNoVerifiedTierTitle,
  formatSearchMarketScope,
  resolveResultTierCounts,
} from "~/lib/search-display";
import type { SearchResponse } from "~/lib/types";

export type SearchAnswerState =
  | "verified"
  | "broader"
  | "no_verified"
  | "degraded"
  | "empty"
  | "idle"
  | "keyword";

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
  /**
   * Optional next-action link rendered below the note. Used by the keyword
   * verdict to point a bare `?q=goat` lookup at the most-likely intended
   * domain (`?website=goat.com`) so the visitor can run a verified search
   * instead of accepting unverified keyword matches as proof.
   */
  nextAction: { label: string; href: string } | null;
}

export function buildSearchAnswer(input: {
  result: SearchResponse;
  displayDomain: string | null;
  isDomainSearch: boolean;
  isBroaderScope: boolean;
  /**
   * The raw search term the visitor typed (`?q=` / `?query=`), used by the
   * keyword verdict to name the brand stem and to derive a suggested
   * verified-search domain. Omitted by callers/tests that only exercise the
   * domain-search verdicts.
   */
  query?: string | null;
  /**
   * Searched market scope from the route filters ("India", … or "all").
   * The Meta Ad Library is country-scoped, so a specific-country verdict
   * names the market that actually ran (e.g. "… in India"). The "all" view
   * is unscoped because `country=ALL` is a single provider query, not a
   * union of every country. Omitted for legacy callers/tests that keep the
   * unscoped copy.
   */
  country?: string | null;
}): SearchAnswer {
  const result = input.result;
  const ads = result.ads ?? [];
  const adCount = ads.length;
  const domain = input.displayDomain?.trim() || null;
  // Only a captured landing-page snapshot is a "Landing-page signal"; the
  // ad's destination URL alone is not evidence the page was ever captured.
  const landingPageCount = ads.filter((ad) => Boolean(ad.landingPage)).length;
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

  if (result.discoveryPartial && adCount === 0) {
    return {
      state: "degraded",
      title: "Search results are partial",
      summary: broaderCount > 0
        ? `${broaderCount} related candidate${broaderCount === 1 ? " is" : "s are"} available on the partial page. Additional results could not be loaded, so this is not a complete no-ads result.`
        : "Additional results could not be loaded, so this is not a complete no-ads result.",
      facts: [
        { label: "Fresh ads", value: "Partial", detail: sourceLabel },
        {
          label: "Related candidates loaded so far",
          value: String(broaderCount),
          detail: broaderCount > 0
            ? "Available to review separately without a verified website claim"
            : "No related candidates are present on the partial page",
        },
        landingFact,
      ],
      // Do not route through customerDiscoverySummary: that helper remaps
      // unknown/partial text into "temporarily delayed" copy.
      note: "Retry to continue loading the remaining results.",
      nextAction: null,
    };
  }

  const answer = buildCompleteSearchAnswer({
    result,
    displayDomain: domain,
    isDomainSearch: input.isDomainSearch,
    isBroaderScope: input.isBroaderScope,
    country: input.country,
    query: input.query,
    adCount,
    broaderCount,
    verifiedCount,
    landingFact,
    sourceLabel,
    landingPageCount,
  });
  if (!result.discoveryPartial || adCount === 0) {
    return answer;
  }
  const qualified = qualifyPartialSearchAnswer(answer, {
    adCount,
    domain,
    verifiedCount,
    country: input.country,
    isDemoSource: result.source === "demo" || result.provider === "demo",
  });
  return {
    ...qualified,
    state: "degraded",
    summary: `${qualified.summary} Additional results could not be loaded, so this page is partial.`,
    note: qualified.note
      ? `${qualified.note} Retry to continue loading the remaining results.`
      : "Retry to continue loading the remaining results.",
  };
}

function qualifyPartialSearchAnswer(
  answer: SearchAnswer,
  input: {
    adCount: number;
    domain: string | null;
    verifiedCount: number;
    country?: string | null;
    isDemoSource?: boolean;
  },
): SearchAnswer {
  const relatedOnlyCount = Math.max(0, input.adCount - input.verifiedCount);
  const marketScopeOptions = { isDemoSource: input.isDemoSource };

  if (answer.state === "broader" && input.domain) {
    return {
      ...answer,
      title: input.verifiedCount > 0
        ? withMarketScope(`${input.verifiedCount} verified and ${relatedOnlyCount} related match${relatedOnlyCount === 1 ? "" : "es"} loaded so far for ${input.domain}`, input.country, marketScopeOptions)
        : withMarketScope(`${input.adCount} broader match${input.adCount === 1 ? "" : "es"} loaded so far for ${input.domain}`, input.country, marketScopeOptions),
      facts: answer.facts.map((fact) => {
        if (fact.label === "Verified matches") {
          return {
            label: "Verified matches loaded so far",
            value: fact.value,
            detail: "Connected to this website on the partial page",
          };
        }
        if (fact.label === "Related matches") {
          return {
            label: "Related matches loaded so far",
            value: fact.value,
            detail: "Unverified advertiser/text candidates on the partial page",
          };
        }
        return fact;
      }),
    };
  }

  if (answer.state === "verified") {
    return {
      ...answer,
      title: input.domain
        ? withMarketScope(`${input.verifiedCount} verified ad${input.verifiedCount === 1 ? "" : "s"} loaded so far for ${input.domain}`, input.country, marketScopeOptions)
        : withMarketScope(`${input.adCount} ad${input.adCount === 1 ? "" : "s"} loaded so far`, input.country, marketScopeOptions),
      facts: answer.facts.map((fact) => {
        if (fact.label === "Verified ads") {
          return {
            label: "Verified ads loaded so far",
            value: fact.value,
            detail: "Connected to this domain on the partial page",
          };
        }
        if (fact.label === "Ads found") {
          return {
            label: "Ads loaded so far",
            value: fact.value,
            detail: "Visible on the partial page",
          };
        }
        return fact;
      }),
    };
  }

  if (answer.state === "no_verified" && input.domain) {
    return {
      ...answer,
      title: withMarketScope(`No verified ads in the results loaded so far for ${input.domain}`, input.country, marketScopeOptions),
      facts: answer.facts.map((fact) => {
        if (fact.label === "Verified ads") {
          return {
            label: "Verified ads loaded so far",
            value: fact.value,
            detail: "Exact website match on the partial page",
          };
        }
        if (fact.label === "Returned ads") {
          return {
            label: "Returned ads loaded so far",
            value: fact.value,
            detail: "Review as unverified candidates on the partial page",
          };
        }
        return fact;
      }),
    };
  }

  return answer;
}

function buildCompleteSearchAnswer(input: {
  result: SearchResponse;
  displayDomain: string | null;
  isDomainSearch: boolean;
  isBroaderScope: boolean;
  country?: string | null;
  query?: string | null;
  adCount: number;
  broaderCount: number;
  verifiedCount: number;
  landingFact: SearchAnswer["facts"][number];
  sourceLabel: string;
  landingPageCount: number;
}): SearchAnswer {
  const result = input.result;
  const adCount = input.adCount;
  const domain = input.displayDomain;
  const broaderCount = input.broaderCount;
  const verifiedCount = input.verifiedCount;
  const landingFact = input.landingFact;
  const sourceLabel = input.sourceLabel;
  const landingPageCount = input.landingPageCount;
  // Demo/sample matches deliberately ignore the country filter, so the
  // verdict title must not name a market — a demo verdict for
  // India-authored samples served under a United States filter would
  // falsely imply country-specific evidence. Skip the market scope for
  // demo sources so the copy stays unscoped.
  const isDemoSource = result.source === "demo" || result.provider === "demo";
  const marketScopeOptions = { isDemoSource };

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
      nextAction: null,
    };
  }

  if (adCount === 0 && input.isDomainSearch && domain && !input.isBroaderScope) {
    return {
      state: "no_verified",
      title: withMarketScope(`No verified ads found for ${domain}`, input.country, marketScopeOptions),
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
      nextAction: null,
    };
  }

  if (adCount === 0) {
    return {
      state: result.discoveryStatus === "disabled" ? "idle" : "empty",
      title: result.discoveryStatus === "disabled"
        ? "Enter a competitor website"
        : withMarketScope("No ads found for this competitor", input.country, marketScopeOptions),
      summary: result.discoveryStatus === "disabled"
        ? "Paste one competitor site to see whether Five to Nine can verify currently available ads."
        : "The search completed without returning visible ads.",
      facts: [
        { label: "Ads found", value: "0", detail: sourceLabel },
      ],
			note: customerDiscoverySummary(result.discoverySummary),
      nextAction: null,
    };
  }

  if (input.isBroaderScope && domain) {
    const relatedOnlyCount = Math.max(0, adCount - verifiedCount);
    return {
      state: "broader",
      title: verifiedCount > 0
        ? withMarketScope(`${verifiedCount} verified and ${relatedOnlyCount} related match${relatedOnlyCount === 1 ? "" : "es"} for ${domain}`, input.country, marketScopeOptions)
        : withMarketScope(`${adCount} broader match${adCount === 1 ? "" : "es"} for ${domain}`, input.country, marketScopeOptions),
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
      nextAction: null,
    };
  }

  if (input.isDomainSearch && domain && verifiedCount === 0) {
    const tiers = resolveResultTierCounts(result);
    const likelyCount = tiers.likely;
    const unmatchedCount = tiers.unmatched;
    // BET 2 (issue 1482): when candidates exist below but none are verified,
    // the headline names the tiers instead of the "No verified ads found"
    // dead-end copy — a first-time visitor with 17 likely rows under a
    // "No verified ads found" head reads the page as broken, not honest.
    const hasCandidates = likelyCount + unmatchedCount > 0;
    return {
      state: "no_verified",
      title: hasCandidates
        ? withMarketScope(formatNoVerifiedTierTitle(domain, tiers), input.country, marketScopeOptions)
        : withMarketScope(`No verified ads found for ${domain}`, input.country, marketScopeOptions),
      summary: hasCandidates
        ? "These ads matched your search but we couldn't verify they belong to the brand. Confirm a likely one before treating it as proof."
        : "Returned ads were not connected to this website through advertiser or landing-page evidence.",
      facts: [
        { label: "Verified ads", value: "0", detail: "Exact website match only" },
        {
          label: "Likely matches",
          value: String(likelyCount),
          detail: likelyCount > 0
            ? "Advertiser name fits this brand; website link not captured"
            : "No brand-name matches",
        },
        {
          label: "Unmatched candidates",
          value: String(unmatchedCount),
          detail: unmatchedCount > 0
            ? "Returned by the source with no brand connection"
            : "No unmatched candidates",
        },
        landingFact,
      ],
      note: "This is not evidence that the competitor is inactive; it only means this search did not verify a connected ad.",
      nextAction: null,
    };
  }

  if (input.isDomainSearch && domain) {
    return {
      state: "verified",
      title: withMarketScope(`${verifiedCount} verified ad${verifiedCount === 1 ? "" : "s"} linked to ${domain}`, input.country, marketScopeOptions),
      summary: "These ads are connected to the competitor website through advertiser or landing-page evidence.",
      facts: [
        { label: "Verified ads", value: String(verifiedCount), detail: "Connected to this domain" },
        landingFact,
        { label: "Source", value: sourceLabel, detail: formatCacheDetail(result.cacheStatus) },
      ],
      note: landingPageCount === 0 ? "Landing-page signals are missing, so treat the ad creative as the current signal." : null,
      nextAction: null,
    };
  }

  // Keyword search (`?q=goat` with no `?website=`). Two shapes, chosen by
  // what the result actually carries:
  //
  // Legacy/v1 results (no tier metadata) and results where nothing connected
  // to the brand keep the goat.com wall: the visitor typed a brand stem, no
  // brand website was searched, so every row is an unverified keyword
  // candidate — never verified ads. The thegoatco.au mouth-tape ad is the
  // load-bearing wrong-brand case — it contains the stem "goat" but is a
  // different company from goat.com.
  //
  // Results that DO carry v2 tier metadata and resolved at least one
  // verified/likely row (issue #1452: q=oura resolves through the brand
  // fallback) must say so: the headline states the verified/likely/unmatched
  // counts from the payload instead of a stale "N unverified keyword
  // matches" string that contradicts the tier-labelled rows below it.
  const keywordStem = input.query?.trim() || null;
  if (!input.isDomainSearch && keywordStem) {
    const suggestedDomain = suggestVerifiedSearchDomain(keywordStem);
    const nextAction = suggestedDomain
      ? {
          label: `Search verified ads for ${suggestedDomain}`,
          href: buildVerifiedSearchHref(suggestedDomain, input.country),
        }
      : null;
    const carriesTierMetadata =
      typeof result.verifiedCount === "number" ||
      typeof result.likelyCount === "number" ||
      typeof result.unmatchedCount === "number" ||
      result.ads.some((ad) => Boolean(ad.domainMatch));
    const tiers = carriesTierMetadata ? resolveResultTierCounts(result) : null;
    const resolvedBrandRows = tiers ? tiers.verified + tiers.likely : 0;
    if (tiers && resolvedBrandRows > 0) {
      return {
        state: "keyword",
        title: withMarketScope(
          `${tiers.verified} verified, ${tiers.likely} likely, ${tiers.unmatched} unmatched for "${keywordStem}"`,
          input.country,
          marketScopeOptions,
        ),
        summary:
          "Rows connected to the brand's website are verified or likely; the rest are candidates with no brand connection.",
        facts: [
          { label: "Verified ads", value: String(tiers.verified), detail: `Connected to the brand behind "${keywordStem}"` },
          { label: "Likely matches", value: String(tiers.likely), detail: tiers.likely > 0 ? "Brand-name match; website link not captured" : "No brand-name matches" },
          { label: "Unmatched candidates", value: String(tiers.unmatched), detail: tiers.unmatched > 0 ? "Returned by the source with no brand connection" : "No unmatched candidates" },
          landingFact,
          { label: "Source", value: sourceLabel, detail: formatCacheDetail(result.cacheStatus) },
        ],
        note: suggestedDomain
          ? `Want the full verified list? Search by website — ${suggestedDomain} — to confirm which ads are linked to it.`
          : null,
        nextAction,
      };
    }
    return {
      state: "keyword",
      title: withMarketScope(
        `${adCount} unverified keyword match${adCount === 1 ? "" : "es"} for "${keywordStem}"`,
        input.country,
        marketScopeOptions,
      ),
      summary:
        "These ads matched the keyword, but none are verified to the brand you meant. A keyword like \u201cgoat\u201d can match unrelated companies (e.g. mouth tape) as well as the marketplace goat.com \u2014 confirm the brand before treating any as proof.",
      facts: [
        { label: "Verified ads", value: "0", detail: "No website was searched, so none can be verified" },
        { label: "Keyword matches", value: String(adCount), detail: "Advertiser name or copy contains the keyword" },
        landingFact,
        { label: "Source", value: sourceLabel, detail: formatCacheDetail(result.cacheStatus) },
      ],
      note: suggestedDomain
        ? `Want verified ads? Search by website \u2014 ${suggestedDomain} \u2014 to confirm which ads are actually linked to it.`
        : "To verify ads for a specific brand, search by website (e.g. goat.com) instead of by keyword.",
      nextAction,
    };
  }

  return {
    state: "verified",
    title: withMarketScope(`${adCount} ad${adCount === 1 ? "" : "s"} found`, input.country, marketScopeOptions),
    summary: "Review the ad cards and selected ad detail to decide what is worth saving or tracking.",
    facts: [
      { label: "Ads found", value: String(adCount), detail: sourceLabel },
      landingFact,
    ],
    note: landingPageCount === 0 ? "Landing-page signals are not captured yet." : null,
    nextAction: null,
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

/**
 * Append the searched market scope to a verdict title ("… in India") when
 * the caller supplied a specific-country filter. The "all" view is
 * unscoped and returns the title unchanged. Omitted country keeps the
 * legacy unscoped copy.
 *
 * Demo/sample sources skip the scope: the resolver deliberately matches
 * every demo ad against every country, so a verdict naming the searched
 * market would falsely imply country-specific evidence. The unscoped copy
 * is the same shape callers without a country or with "all" get.
 */
function withMarketScope(
  title: string,
  country: string | null | undefined,
  options: { isDemoSource?: boolean } = {},
): string {
  if (options.isDemoSource) {
    return title;
  }
  const scope = formatSearchMarketScope(country);
  return scope ? `${title} ${scope}` : title;
}

/**
 * Derive the most-likely intended domain from a bare keyword so the keyword
 * verdict can offer a verified-search next action. A single bare label with
 * no dots or spaces (e.g. "goat") maps to `<label>.com` (goat.com). Anything
 * that already looks like a domain, a path, or a multi-word phrase is left
 * alone — the caller already has a domain or the intent is too ambiguous to
 * guess.
 */
function suggestVerifiedSearchDomain(keyword: string): string | null {
  const stem = keyword.trim().toLowerCase();
  if (!stem) {
    return null;
  }
  // Already a domain-like input — the caller should have used ?website=, so
  // do not fabricate a second guess.
  if (stem.includes(".") || stem.includes("/") || stem.includes(" ")) {
    return null;
  }
  // Strip common brand-noise suffixes so "goat app" → "goat" → "goat.com",
  // not "goatapp.com". Conservative: only trailing "app"/"hq"/"co" when the
  // remaining stem is at least 3 chars (avoids "co" → "" ).
  const cleaned = stem.replace(/(app|hq|co)$/, (suffix, _match, offset) =>
    offset >= 3 ? "" : suffix,
  );
  const label = cleaned || stem;
  if (label.length < 2) {
    return null;
  }
  return `${label}.com`;
}

/**
 * Build the `/search?website=…` href for the keyword verdict's next-action
 * link. Preserves the searched country so the verified search runs in the
 * same market the visitor was looking at.
 */
function buildVerifiedSearchHref(domain: string, country: string | null | undefined): string {
  const params = new URLSearchParams();
  params.set("website", domain);
  if (country && country.trim() && country.trim().toLowerCase() !== "all") {
    params.set("country", country.trim());
  }
  return `/search?${params.toString()}`;
}
