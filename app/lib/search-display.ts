/**
 * Pure display, formatting, accumulation, and URL helpers for the /search
 * route. Extracted from search.tsx so the route file keeps only its
 * loader/action and the top-level component. No hooks, no JSX, no server-only
 * concerns — everything here is deterministic and unit-testable in isolation.
 */

import { formatAdsFoundLabel } from "~/lib/analysis-display";
import { customerDiscoverySummary } from "~/lib/discovery-customer-copy";
import { normalizeSavedQuery } from "~/lib/normalize";
import type {
  AdRecord,
  SearchFilters,
  SearchResponse,
  WatchlistTrackingRole,
} from "~/lib/types";

/** Recovery window for the client-side "search checks recovered" hint. */
export const SEARCH_DELAY_RECOVERY_WINDOW_MS = 5 * 60 * 1000;

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

export function formatSearchFreshnessLabel(result: SearchResponse) {
  if (isDelayedDiscoveryStatus(result.discoveryStatus))
    return "Fresh check delayed";
  if (result.cacheStatus === "hit") return "Recent cached result";
  if (result.cacheStatus === "stale") return "Older cached result";
  if (result.cacheStatus === "miss") return "Fresh result";
  return "Freshness unavailable";
}

export function formatProofCaptureLabel(ad: AdRecord) {
  if (ad.landingPage?.capturedAt) {
    const capturedAt = new Date(ad.landingPage.capturedAt);
    if (!Number.isNaN(capturedAt.getTime())) {
      return `Landing page checked ${capturedAt.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}`;
    }
  }
  return ad.landingPageUrl
    ? "Landing page not captured yet"
    : "No landing-page destination available";
}

export function formatHookLabel(hook: string) {
  return hook.trim() || "Hook not detected.";
}

export function formatOfferLabel(offer: string) {
  return offer.trim() || "No explicit offer detected.";
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
  const lines = String(value ?? "")
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
      /competitor ad checks is already warming this query\.?/gi,
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

  const resultCount = result.ads.length;
  const resultLabel = resultCount === 1 ? "result" : "results";
  const completion = result.nextCursor
    ? " More results are available."
    : " No more results.";
  const recovery = options.recovered ? " Search checks have recovered." : "";

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

export function formatEmptyResultHeadline(
  result: SearchResponse,
  context: {
    displayDomain?: string | null;
    isDomainSearch?: boolean;
    isBroaderScope?: boolean;
    relevanceApplied?: boolean;
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

  if (
    context.relevanceApplied &&
    context.isDomainSearch &&
    context.displayDomain &&
    !context.isBroaderScope
  ) {
    return `No verified ads found for ${context.displayDomain}`;
  }

  return "No ads found for this competitor";
}

export function isDelayedDiscoveryStatus(
  status: SearchResponse["discoveryStatus"],
) {
  return status === "degraded" || status === "cache_only";
}

export function formatResultsPanelTitle(
  result: SearchResponse,
  context: {
    displayDomain?: string | null;
    isDomainSearch?: boolean;
    isBroaderScope?: boolean;
    relevanceApplied?: boolean;
  } = {},
) {
  if (result.ads.length > 0) {
    if (
      context.relevanceApplied &&
      context.isDomainSearch &&
      context.displayDomain &&
      !context.isBroaderScope
    ) {
      const verifiedNoun = result.ads.length === 1 ? "ad" : "ads";
      return `${result.ads.length} verified ${verifiedNoun} linked to ${context.displayDomain}`;
    }

    if (context.isBroaderScope && context.displayDomain) {
      const verifiedCount = Math.max(0, Math.floor(result.verifiedCount ?? 0));
      const relatedCount = Math.max(0, result.ads.length - verifiedCount);
      const relatedNoun = relatedCount === 1 ? "match" : "matches";
      const broaderNoun = result.ads.length === 1 ? "match" : "matches";
      return verifiedCount > 0
        ? `${verifiedCount} verified and ${relatedCount} related ${relatedNoun} for ${context.displayDomain}`
        : `${result.ads.length} broader ${broaderNoun} for ${context.displayDomain}`;
    }

    return formatAdsFoundLabel(result.ads.length);
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
    return `No verified ads for ${context.displayDomain}`;
  }

  return formatAdsFoundLabel(0);
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
