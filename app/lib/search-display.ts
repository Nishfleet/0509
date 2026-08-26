/**
 * Pure display, formatting, accumulation, and URL helpers for the /search
 * route. Extracted from search.tsx so the route file keeps only its
 * loader/action and the top-level component. No hooks, no JSX, no server-only
 * concerns — everything here is deterministic and unit-testable in isolation.
 */

import { formatAdsFoundLabel } from "~/lib/analysis-display";
import {
  ALL_COUNTRIES_VALUE,
  countryNameFromIso,
  isoFromCountryName,
} from "~/lib/countries";
import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import { normalizeSavedQuery } from "~/lib/normalize";
import { domainMatchTier } from "~/lib/search-domain-match";
import { scrubBrokenUnicode } from "~/lib/text-safe";
import type {
  AdRecord,
  SearchFilters,
  SearchResponse,
  WatchlistTrackingRole,
} from "~/lib/types";

/** Recovery window for the client-side "search checks recovered" hint. */
const SEARCH_DELAY_RECOVERY_WINDOW_MS = 5 * 60 * 1000;

export function buildIdleSearchResult(): SearchResponse {
  return {
    ads: [],
    nextCursor: null,
    source: "demo",
    cacheStatus: "none",
    discoveryStatus: "disabled",
    discoverySummary: null,
    discoveryFailureClass: null,
  };
}

/**
 * Page-level H1 for the public /search route. When the visitor lands from a
 * shared keyword link (`?q=` or `?query=`) with a country scope, the heading
 * names the brand and the market the search actually ran in. The idle page
 * keeps the generic "Find competitor ads" title. The all-countries value is
 * a single Meta Ad Library `country=ALL` query, not worldwide coverage, so
 * that heading names the query rather than claiming every market.
 */
export function formatSearchCommandTitle(
  query: string,
  country: string,
): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return "Find competitor ads";
  }
  const brand = titleCaseSearchTerm(trimmed);
  const scope = formatSearchPageScope(country);
  return scope ? `${brand} ads ${scope}` : `${brand} ads`;
}

/**
 * H1 scope phrase for a shared `/search` URL. Named markets stay "in India"
 * / "in United States". `country=all` names the Meta Ad Library's single
 * all-countries query — the same honesty rule as `/ads/:domain` — and must
 * never say "in all countries" or "across all countries".
 */
export function formatSearchPageScope(
  country: string | null | undefined,
): string | null {
  const trimmed = country?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase() === ALL_COUNTRIES_VALUE) {
    return "from the Meta Ad Library's all-countries query";
  }
  return formatSearchMarketScope(country);
}

function titleCaseSearchTerm(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const [first, ...rest] = part;
      return `${first?.toUpperCase() ?? ""}${rest.join("").toLowerCase()}`;
    })
    .join(" ");
}

export interface SearchAccumulationState {
  searchKey: string;
  result: SearchResponse;
  selectedAd: AdRecord | null;
  adCursorById: ReadonlyMap<string, string | null>;
  addedCount: number;
  retryCursor: string | null;
}

export function buildSearchAccumulationKey(data: {
  fingerprint: string;
  mode: string;
  searchScope: string;
  competitorWebsite?: {
    normalizedUrl?: string | null;
    raw?: string | null;
  } | null;
}) {
  return JSON.stringify({
    fingerprint: data.fingerprint,
    mode: data.mode,
    searchScope: data.searchScope,
    website:
      data.competitorWebsite?.normalizedUrl ??
      data.competitorWebsite?.raw ??
      null,
  });
}

export function createSearchAccumulationState(
  searchKey: string,
  result: SearchResponse,
  selectedAd: AdRecord | null,
  requestedCursor: string | null = null,
): SearchAccumulationState {
  return {
    searchKey,
    result,
    selectedAd,
    adCursorById: new Map(
      result.ads.map((ad) => [ad.metaAdId, requestedCursor]),
    ),
    addedCount: 0,
    retryCursor: null,
  };
}

export function mergeSearchAccumulationState(
  previous: SearchAccumulationState,
  incoming: SearchResponse,
  input: {
    requestedCursor: string | null;
    selectedAd: AdRecord | null;
    selectionNavigation?: boolean;
  },
): SearchAccumulationState {
  if (
    input.requestedCursor &&
    !input.selectionNavigation &&
    isDelayedDiscoveryStatus(incoming.discoveryStatus) &&
    incoming.ads.length === 0
  ) {
    return {
      ...previous,
      result: {
        ...incoming,
        ads: previous.result.ads,
        nextCursor: input.requestedCursor,
      },
      selectedAd: input.selectedAd ?? previous.selectedAd,
      addedCount: 0,
      retryCursor: input.requestedCursor,
    };
  }

  const priorIds = new Set(previous.result.ads.map((ad) => ad.metaAdId));
  const mergedAds = new Map(previous.result.ads.map((ad) => [ad.metaAdId, ad]));
  const adCursorById = new Map(previous.adCursorById);
  for (const ad of incoming.ads) {
    mergedAds.set(ad.metaAdId, ad);
    if (!adCursorById.has(ad.metaAdId)) {
      adCursorById.set(ad.metaAdId, input.requestedCursor);
    }
  }

  return {
    searchKey: previous.searchKey,
    result: {
      ...incoming,
      ads: Array.from(mergedAds.values()),
      nextCursor: input.selectionNavigation
        ? previous.result.nextCursor
        : input.requestedCursor
          ? incoming.nextCursor
          : previous.result.nextCursor,
    },
    selectedAd: input.selectedAd ?? previous.selectedAd,
    adCursorById,
    addedCount: incoming.ads.filter((ad) => !priorIds.has(ad.metaAdId)).length,
    retryCursor: null,
  };
}

export function formatSearchSourceLabel(result: SearchResponse) {
  if (
    result.provider === "meta_library_browser" ||
    result.source === "meta_library_browser"
  ) {
    return "Source: Meta Ad Library visual check";
  }
  if (result.provider === "meta_api" || result.source === "meta_api") {
    return "Source: Meta Ad Library API";
  }
  if (result.source === "demo") {
    return "Source: sample data";
  }
  return "Source: search result";
}

/**
 * True only when a result was produced by a genuinely LIVE Ad Library capture
 * in this request: a cache miss served straight from a real Meta provider in a
 * healthy, non-delayed check. Never true for demo sample data, a cached copy,
 * a stale/expired entry, a delayed/degraded check, or a partial capture.
 *
 * This is the single gate behind which the public search page may make a
 * fresh/live ("right now") claim. Everywhere else the freshness label says
 * honestly what it is: cached, older, delayed, or partial.
 */
export function isProvenFreshLiveCapture(result: SearchResponse): boolean {
  if (result.source === "demo" || result.provider === "demo") return false;
  if (result.discoveryPartial) return false;
  if (isDelayedDiscoveryStatus(result.discoveryStatus)) return false;
  // Fail closed: only an explicitly healthy, undelayed check may be proven
  // fresh-live. An absent/unknown discovery status cannot prove a live capture.
  if (result.discoveryStatus !== "healthy") return false;
  return result.cacheStatus === "miss";
}

/**
 * True when the result was produced from the demo/sample dataset rather than
 * a live Ad Library lookup. Demo matches deliberately ignore the country
 * filter (every demo ad matches every market), so a verdict title naming
 * the searched country for a demo result would falsely imply
 * country-specific evidence. Used to keep demo verdict copy unscoped.
 */
function isDemoSourceResult(result: SearchResponse): boolean {
  return result.source === "demo" || result.provider === "demo";
}

export function formatSearchFreshnessLabel(result: SearchResponse) {
  if (result.discoveryPartial) return "Fresh partial result";
  if (isDelayedDiscoveryStatus(result.discoveryStatus))
    return "Fresh check delayed";
  // The only state that may claim fresh/live: this request actually ran a live
  // Ad Library capture (cache miss on a healthy, non-demo provider). Cached
  // hits and stale entries are labeled as the cache they are instead.
  if (isProvenFreshLiveCapture(result)) return "Fresh live result";
  if (result.cacheStatus === "hit") return "Recent cached result";
  if (result.cacheStatus === "stale") return "Older cached result";
  return "Freshness unavailable";
}

/**
 * Coarse honest age of the snapshot a cache-served result is showing, e.g.
 * "Captured about 3 hours ago". Per-country discovery cache entries age
 * independently (each country is its own key with its own TTL), so two
 * country filters can legitimately show different counts at one moment — the
 * result view must render each snapshot's age so a stale country view is
 * self-evidently stale instead of looking current.
 *
 * Deterministic per call with an explicit `now`: the search loader computes
 * the label once at request time and ships the string, so the server-rendered
 * and hydrated client copy can never differ (the proof-label UTC rule).
 * Returns null when no capture timestamp exists (live captures, demo, errors).
 */
export function formatSearchCaptureAgeLabel(
  fetchedAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!fetchedAt) return null;
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return null;

  const elapsedMs = Math.max(0, now.getTime() - fetchedMs);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "Captured moments ago";
  if (minutes < 60) return `Captured about ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 2) return "Captured about an hour ago";
  if (hours < 24) return `Captured about ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Captured about a day ago";
  return `Captured about ${days} days ago`;
}

/**
 * Deterministic formatter for the "Landing page checked …" proof label.
 * Locale and timezone are pinned so the server-rendered label equals the
 * hydrated client copy: `toLocaleString(undefined, …)` picks the runtime's
 * default locale and timezone, which differ between SSR (UTC) and the
 * visitor's browser (their local zone and language) and would fire a React
 * hydration mismatch. UTC is the stored instant's canonical timezone; the
 * label spells it out so the timestamp is not mistaken for local time.
 */
const PROOF_CAPTURE_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatProofCaptureLabel(ad: AdRecord) {
  if (ad.landingPage?.capturedAt) {
    const capturedAt = new Date(ad.landingPage.capturedAt);
    if (!Number.isNaN(capturedAt.getTime())) {
      return `Landing page checked ${PROOF_CAPTURE_DATE_FORMATTER.format(
        capturedAt,
      )} UTC`;
    }
  }
  return ad.landingPageUrl
    ? "Landing page not captured yet"
    : "No landing-page destination available";
}

export function formatSelectedLandingHeadline(input: {
  rawHeadline: string | null | undefined;
  landingPageUrl: string | null | undefined;
  hasLandingPage: boolean;
  pending: boolean;
}): string {
  const headline = input.rawHeadline?.trim();
  if (headline) return headline;
  if (input.pending) return "Analyzing creative…";
  if (input.landingPageUrl?.trim() && !input.hasLandingPage) {
    return "Couldn't capture this page";
  }
  return "Headline not captured yet";
}

export function formatSelectedLandingFactValue(input: {
  capturedLabel: string;
  landingPageUrl: string | null | undefined;
  hasLandingPage: boolean;
  pending: boolean;
  failedPageCheck?: boolean;
}): string {
  if (input.hasLandingPage) return input.capturedLabel;
  if (input.pending) return "Analyzing creative…";
  if (input.landingPageUrl?.trim() && !input.hasLandingPage) {
    return input.failedPageCheck ? "Couldn't check this page" : "Unavailable";
  }
  return input.capturedLabel;
}

export function formatHookLabel(hook: string) {
  return scrubBrokenUnicode(hook).trim() || "Hook not detected.";
}

export function formatOfferLabel(offer: string) {
  return scrubBrokenUnicode(offer).trim() || "No explicit offer detected.";
}

export function formatCreativeFormatLabel(format: AdRecord["format"]) {
  return format === "unknown" ? "Not detected" : format;
}

export function formatAdActiveStatus(
  ad: Pick<AdRecord, "active" | "activeStatusObserved">,
) {
  if (ad.activeStatusObserved === false) {
    return "Status not detected";
  }
  return ad.active ? "Active" : "Inactive";
}

export function shouldShowApproximateFormatNotice(
  filters: Pick<SearchFilters, "creativeType">,
  result: Pick<SearchResponse, "provider" | "source">,
) {
  return (
    filters.creativeType !== "all" &&
    (result.provider === "meta_library_browser" ||
      result.source === "meta_library_browser")
  );
}

export function formatResultCardSummary(
  ad: Pick<
    AdRecord,
    | "advertiser"
    | "body"
    | "hook"
    | "offer"
    | "previewHeadline"
    | "previewSubhead"
  >,
) {
  return (
    firstDistinctDisplayText(
      [ad.hook, ad.body, ad.previewSubhead, ad.offer],
      [ad.previewHeadline, ad.advertiser],
    ) ?? "Ad copy not captured"
  );
}

export function formatAdDetailBody(
  ad: Pick<AdRecord, "body" | "hook" | "previewHeadline" | "previewSubhead">,
) {
  return (
    firstDistinctDisplayText(
      [ad.body, ad.hook, ad.previewSubhead],
      [ad.previewHeadline],
    ) ?? ad.previewHeadline
  );
}

function firstDistinctDisplayText(
  candidates: Array<string | null | undefined>,
  existing: Array<string | null | undefined>,
) {
  const seen = new Set(existing.map(normalizeDisplayText).filter(Boolean));

  for (const candidate of candidates) {
    const cleaned = cleanDisplayText(candidate);
    const normalized = normalizeDisplayText(cleaned);
    if (!cleaned || !normalized || seen.has(normalized)) {
      continue;
    }
    return cleaned;
  }

  return null;
}

function cleanDisplayText(value: string | null | undefined) {
  // Scrub already-persisted corruption (U+FFFD / lone surrogates) so a stale
  // cache entry can never render the broken-emoji glyph on /search. Real
  // emoji (well-formed surrogate pairs) pass through untouched.
  const lines = scrubBrokenUnicode(String(value ?? ""))
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const line of lines) {
    const normalized = normalizeDisplayText(line);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(line);
  }

  return unique.join("\n");
}

function normalizeDisplayText(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function formatDiscoverySummary(result: SearchResponse) {
  if (!result.discoverySummary) {
    return null;
  }

  if (
    result.ads.length > 0 &&
    /no cached results are available/i.test(result.discoverySummary)
  ) {
    return "Live ad checks are temporarily delayed, so we're showing your most recent results. We'll retry automatically.";
  }

  if (/rate limited|degraded/i.test(result.discoverySummary)) {
    return customerDiscoverySummary(result.discoverySummary);
  }

  if (/API fallback/i.test(result.discoverySummary)) {
    const fallbackUnavailable =
      isDelayedDiscoveryStatus(result.discoveryStatus) ||
      Boolean(result.discoveryFailureClass) ||
      /failed/i.test(result.discoverySummary);

    if (fallbackUnavailable) {
      return "Fresh visual checks are delayed and no alternate results are available.";
    }

    if (result.ads.length === 0) {
      return "Fresh visual checks are delayed; alternate Meta checks found no ads.";
    }

    return "Fresh visual checks are delayed; showing alternate Meta ad results.";
  }

  return result.discoverySummary
    .replace(/Commercial discovery/gi, "Competitor ad checks")
    .replace(/commercial discovery/gi, "competitor ad checks")
    .replace(
      // First-request cold-path warming says "is warming this query"; a
      // concurrent retry says "is already warming this query". Same customer
      // line for both.
      /competitor ad checks is (?:already )?warming this query\.?/gi,
      "We are checking this competitor now.",
    )
    .replace(/query/gi, "competitor")
    .replace(/Browser Run/gi, "visual checks")
    .replace(/API fallback/gi, "alternate Meta ad results")
    .replace(/cached live results/gi, "recent results")
    .replace(/cached results/gi, "recent results")
    .replace(
      /recent results should appear shortly/gi,
      "Results should appear shortly",
    )
    .replace(/(^|[.!?]\s+)([a-z])/g, (match) => match.toUpperCase());
}

export function formatSearchResultsAnnouncement(
  result: SearchResponse,
  options: {
    isLoading?: boolean;
    recovered?: boolean;
    addedCount?: number;
    retryCursor?: string | null;
  } = {},
) {
  if (options.isLoading) {
    return "Loading more search results…";
  }

  // A "disabled" result means no search ran: the idle pre-search page, an
  // input the instrument refused (invalid website), or a throttled search.
  // Claiming "Search complete" for any of them would be a lie — the status
  // region says what to do instead of asserting a completion that never
  // happened.
  if (result.discoveryStatus === "disabled") {
    return "Enter a competitor website to start.";
  }

  const resultCount = result.ads.length;
  const resultLabel = resultCount === 1 ? "result" : "results";
  const completion = result.nextCursor
    ? " More results are available."
    : " No more results.";
  const recovery = options.recovered ? " Search checks have recovered." : "";

  if (result.discoveryPartial) {
    if (options.addedCount && options.addedCount > 0) {
      const addedLabel = options.addedCount === 1 ? "result" : "results";
      return `${options.addedCount} more ${addedLabel} loaded. ${resultCount} total search ${resultLabel}. Additional results could not be loaded; retry to continue.`;
    }
    if (resultCount === 0) {
      return "No fresh search results loaded. Additional results could not be loaded; retry to continue.";
    }
    return `${resultCount} fresh search ${resultLabel} loaded. Additional results could not be loaded; retry to continue.`;
  }

  if (options.retryCursor) {
    const availabilityVerb = resultCount === 1 ? "remains" : "remain";
    return `${resultCount} search ${resultLabel} ${availabilityVerb} available. Fresh checks for more results are delayed. Retry when ready.`;
  }

  if (isDelayedDiscoveryStatus(result.discoveryStatus)) {
    if (resultCount === 0) {
      return "No results loaded. Fresh checks are delayed, so coverage may be incomplete.";
    }
    return `${resultCount} ${resultLabel} loaded. Fresh checks are delayed; showing recent results.${
      result.nextCursor ? " More results are available." : ""
    }`;
  }

  if (resultCount === 0) {
    return `No search results found. Search complete.${recovery}`;
  }

  if (options.addedCount && options.addedCount > 0) {
    const addedLabel = options.addedCount === 1 ? "result" : "results";
    return `${options.addedCount} more ${addedLabel} loaded. ${resultCount} total search ${resultLabel}.${completion}${recovery}`;
  }

  return `${resultCount} search ${resultLabel} loaded.${completion}${recovery}`;
}

export function resolveRecoveredSearchKey(input: {
  currentDiscoveryStatus: SearchResponse["discoveryStatus"];
  currentRecoveryKey: string | null;
  previousDiscoveryStatus: SearchResponse["discoveryStatus"];
  searchKey: string;
}) {
  if (isDelayedDiscoveryStatus(input.currentDiscoveryStatus)) {
    return null;
  }
  if (isDelayedDiscoveryStatus(input.previousDiscoveryStatus)) {
    return input.searchKey;
  }
  return input.currentRecoveryKey === input.searchKey
    ? input.currentRecoveryKey
    : null;
}

export function hasRecentSearchDelay(raw: string | null, now = Date.now()) {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as {
      delayed?: unknown;
      observedAt?: unknown;
    };
    return (
      parsed.delayed === true &&
      typeof parsed.observedAt === "number" &&
      Number.isFinite(parsed.observedAt) &&
      parsed.observedAt <= now &&
      now - parsed.observedAt <= SEARCH_DELAY_RECOVERY_WINDOW_MS
    );
  } catch {
    return false;
  }
}

/**
 * BET 2 three-tier result model. Resolve the per-tier counts either from the
 * v2 post-filter's explicit counts or by reading each ad's `domainMatch`
 * level. Returns zeros when no tier metadata is present (legacy results).
 */
export function resolveResultTierCounts(
  result: SearchResponse,
): { verified: number; likely: number; unmatched: number } {
  // The v2 post-filter populates all three tier counts together. Use them
  // directly when present.
  if (
    typeof result.likelyCount === "number" &&
    typeof result.unmatchedCount === "number"
  ) {
    return {
      verified: Math.max(0, Math.floor(result.verifiedCount ?? 0)),
      likely: Math.max(0, Math.floor(result.likelyCount ?? 0)),
      unmatched: Math.max(0, Math.floor(result.unmatchedCount ?? 0)),
    };
  }
  // Count via per-ad domainMatch levels. When a legacy result sets
  // `verifiedCount` explicitly (without per-ad levels), trust it for the
  // verified tier and derive likely/unmatched from the remaining ads.
  const explicitVerified =
    typeof result.verifiedCount === "number"
      ? Math.max(0, Math.floor(result.verifiedCount))
      : null;
  let verified = 0;
  let likely = 0;
  let unmatched = 0;
  for (const ad of result.ads) {
    const tier = domainMatchTier(ad.domainMatch?.level);
    if (tier === "verified") verified += 1;
    else if (tier === "likely") likely += 1;
    else unmatched += 1;
  }
  if (explicitVerified !== null && verified === 0) {
    verified = Math.min(explicitVerified, result.ads.length);
    unmatched = Math.max(0, result.ads.length - verified - likely);
  }
  return { verified, likely, unmatched };
}

/**
 * The customer-facing tier word for one result row. `null` when the ad carries
 * no domain-match metadata (legacy/non-v2 results render no tier label).
 */
export function formatResultTierLabel(ad: AdRecord): string | null {
  if (!ad.domainMatch) {
    return null;
  }
  const tier = domainMatchTier(ad.domainMatch.level);
  if (tier === "verified") {
    return null;
  }
  return tier === "likely" ? "Likely" : "Unmatched";
}

/**
 * One-line confidence note for the detail pane, expanding the tier word into
 * the reason the match is not verified. Returns null for verified rows (the
 * detail pane already states the landing-page/advertiser proof).
 */
export function formatResultTierConfidence(ad: AdRecord): string | null {
  if (!ad.domainMatch) {
    return null;
  }
  const tier = domainMatchTier(ad.domainMatch.level);
  if (tier === "verified") {
    return null;
  }
  if (tier === "likely") {
    return "Likely match — the advertiser name fits this brand, but no website link was captured. Confirm “yes, that's them” before treating it as proof.";
  }
  return "Unmatched — returned by the source, but nothing connects this ad to the searched website.";
}

export function formatEmptyResultHeadline(
  result: SearchResponse,
  context: {
    displayDomain?: string | null;
    isDomainSearch?: boolean;
    isBroaderScope?: boolean;
    relevanceApplied?: boolean;
    country?: string | null;
  } = {},
) {
  if (result.discoveryStatus === "disabled") {
    return "Enter a competitor website";
  }

  if (
    /warming this query|already warming/i.test(result.discoverySummary ?? "")
  ) {
    return "Checking this competitor";
  }

  if (isDelayedDiscoveryStatus(result.discoveryStatus)) {
    return "Search preview is temporarily unavailable";
  }

  // Demo/sample results are not actually filtered by the searched country,
  // so the verdict title must not name a market — otherwise a demo
  // verdict for India-authored samples served under a United States
  // filter would falsely imply country-specific evidence.
  const isDemoSource = isDemoSourceResult(result);
  const marketScopeOptions = { isDemoSource };

  if (
    context.relevanceApplied &&
    context.isDomainSearch &&
    context.displayDomain &&
    !context.isBroaderScope
  ) {
    return withMarketScope(
      `No verified ads found for ${context.displayDomain}`,
      context.country,
      marketScopeOptions,
    );
  }

  return withMarketScope(
    "No ads found for this competitor",
    context.country,
    marketScopeOptions,
  );
}

export function isDelayedDiscoveryStatus(
  status: SearchResponse["discoveryStatus"],
) {
  return status === "degraded" || status === "cache_only";
}

/**
 * BET 2 panel title for an exact-scope domain search with zero verified ads
 * but non-empty candidate rows. Names the likely and unmatched tiers so the
 * headline matches the rows below it instead of contradicting them.
 */
function formatNoVerifiedTierTitle(
  displayDomain: string,
  tiers: { verified: number; likely: number; unmatched: number },
): string {
  const parts: string[] = [];
  if (tiers.likely > 0) {
    const noun = tiers.likely === 1 ? "likely match" : "likely matches";
    parts.push(`${tiers.likely} ${noun}`);
  }
  if (tiers.unmatched > 0) {
    const noun = tiers.unmatched === 1 ? "unmatched candidate" : "unmatched candidates";
    parts.push(`${tiers.unmatched} ${noun}`);
  }
  if (parts.length === 0) {
    return `No verified ads for ${displayDomain}`;
  }
  return `No verified ads for ${displayDomain} — ${parts.join(", ")}`;
}

export function formatResultsPanelTitle(
  result: SearchResponse,
  context: {
    displayDomain?: string | null;
    isDomainSearch?: boolean;
    isBroaderScope?: boolean;
    relevanceApplied?: boolean;
    country?: string | null;
  } = {},
) {
  // Demo/sample results are not actually filtered by the searched country,
  // so the verdict title must not name a market — otherwise a demo
  // verdict for India-authored samples served under a United States
  // filter would falsely imply country-specific evidence.
  const isDemoSource = isDemoSourceResult(result);
  const marketScopeOptions = { isDemoSource };
  if (result.ads.length > 0) {
    if (
      context.relevanceApplied &&
      context.isDomainSearch &&
      context.displayDomain &&
      !context.isBroaderScope
    ) {
      // BET 2: the panel title names the VERIFIED count, not the raw row count,
      // because exact scope now keeps likely + unmatched candidates on the page
      // too. A 0-verified / 17-likely result must read "No verified ads for X —
      // 17 likely matches", never "17 verified ads linked to X".
      const tiers = resolveResultTierCounts(result);
      if (tiers.verified > 0) {
        const verifiedNoun = tiers.verified === 1 ? "ad" : "ads";
        return withMarketScope(
          `${tiers.verified} verified ${verifiedNoun} linked to ${context.displayDomain}`,
          context.country,
          marketScopeOptions,
        );
      }
      return withMarketScope(
        formatNoVerifiedTierTitle(context.displayDomain, tiers),
        context.country,
        marketScopeOptions,
      );
    }

    if (context.isBroaderScope && context.displayDomain) {
      const verifiedCount = Math.max(0, Math.floor(result.verifiedCount ?? 0));
      const relatedCount = Math.max(0, result.ads.length - verifiedCount);
      const relatedNoun = relatedCount === 1 ? "match" : "matches";
      const broaderNoun = result.ads.length === 1 ? "match" : "matches";
      return verifiedCount > 0
        ? withMarketScope(
            `${verifiedCount} verified and ${relatedCount} related ${relatedNoun} for ${context.displayDomain}`,
            context.country,
            marketScopeOptions,
          )
        : withMarketScope(
            `${result.ads.length} broader ${broaderNoun} for ${context.displayDomain}`,
            context.country,
            marketScopeOptions,
          );
    }

    return withMarketScope(
      formatAdsFoundLabel(result.ads.length),
      context.country,
      marketScopeOptions,
    );
  }

  if (
    /warming this query|already warming/i.test(result.discoverySummary ?? "")
  ) {
    return "Search in progress";
  }

  if (
    context.relevanceApplied &&
    context.isDomainSearch &&
    context.displayDomain &&
    !context.isBroaderScope
  ) {
    return withMarketScope(
      `No verified ads for ${context.displayDomain}`,
      context.country,
      marketScopeOptions,
    );
  }

  return withMarketScope(
    formatAdsFoundLabel(0),
    context.country,
    marketScopeOptions,
  );
}

/**
 * Market-scope phrase for search verdict copy, from the searched country
 * filter ("India", "United States", … or "all"). The Meta Ad Library is
 * country-scoped, so a verdict about a competitor must name the market the
 * search actually ran in: the same competitor can legitimately show ads in
 * one market and none in another, and unqualified copy ("No verified ads
 * found for X") would contradict the country-filtered answer for the same
 * competitor. The "all" view returns null to keep the verdict unscoped,
 * because `country=ALL` is a single Meta Ad Library query, not a union of
 * every country.
 *
 * The raw URL input is canonicalized through the country catalog so a
 * visitor who deep-links with `country=IN` or `country=usa` reads as
 * "in India" / "in United States" instead of "in IN" / "in usa"; the
 * provider already resolves the same aliases for the actual lookup, so
 * the customer-facing phrase matches the market the search ran in. Falls
 * back to the trimmed input when the value is unknown to the catalog, and
 * returns null when no country was passed (legacy callers keep the
 * unscoped copy).
 */
export function formatSearchMarketScope(
  country: string | null | undefined,
): string | null {
  const trimmed = country?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase() === ALL_COUNTRIES_VALUE) {
    return null;
  }
  const canonical =
    countryNameFromIso(isoFromCountryName(trimmed)) ?? trimmed;
  return `in ${canonical}`;
}

function withMarketScope(
  title: string,
  country: string | null | undefined,
  options: { isDemoSource?: boolean } = {},
): string {
  // Demo/sample data is not actually filtered by the searched country — the
  // resolver deliberately matches every demo ad against every country, so
  // labelling a demo verdict "in United States" for a result that returns
  // India-authored samples would falsely imply country-specific evidence.
  // Skip the market scope for demo sources so the copy stays unscoped, the
  // same shape legacy callers (no country passed) already used.
  if (options.isDemoSource) {
    return title;
  }
  const scope = formatSearchMarketScope(country);
  return scope ? `${title} ${scope}` : title;
}

export function canCreateAdvertiserWatchlist(
  query: ReturnType<typeof normalizeSavedQuery>,
) {
  return (
    query.mode === "advertiser" &&
    Boolean(query.filters.query) &&
    query.filters.platform === "all" &&
    query.filters.creativeType === "all" &&
    query.filters.status === "all" &&
    !query.filters.firstSeenFrom &&
    !query.filters.lastSeenFrom
  );
}

function withSelected(params: URLSearchParams, selected: string | null) {
  const next = new URLSearchParams(params);
  if (selected) {
    next.set("selected", selected);
  }
  return next;
}

export function withSearchScope(
  params: URLSearchParams,
  scope: "exact" | "broader",
) {
  const next = new URLSearchParams(params);
  if (scope === "broader") next.set("broader", "1");
  else next.delete("broader");
  return next;
}

export function appendCursor(
  params: URLSearchParams,
  after: string,
  selected: string | null,
) {
  const next = withSelected(params, selected);
  next.set("after", after);
  return next;
}

export function buildSearchResultHref(
  params: URLSearchParams,
  selected: string,
  sourceCursor: string | null,
) {
  const next = sourceCursor
    ? appendCursor(params, sourceCursor, selected)
    : withSelected(params, selected);
  return `/search?${next.toString()}#selected-proof`;
}

function withCompetitorWebsite(params: URLSearchParams, website: string) {
  const next = new URLSearchParams(params);
  if (website.trim()) {
    next.set("website", website.trim());
  }
  return next;
}

export function withTrackingContext(
  params: URLSearchParams,
  website: string,
  trackingRole: WatchlistTrackingRole,
) {
  const next = withCompetitorWebsite(params, website);
  next.set("trackingRole", trackingRole);
  return next;
}
