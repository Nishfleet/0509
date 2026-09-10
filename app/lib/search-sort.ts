import { domainMatchTier } from "~/lib/search-domain-match";
import type { AdRecord } from "~/lib/types";

export type SearchResultSort =
  | "active_first"
  | "longest_running"
  | "newest"
  | "verified_first";

export const DEFAULT_SEARCH_RESULT_SORT: SearchResultSort = "active_first";

/**
 * Default sort for anonymous /search sessions (issue #2289): the public
 * preview of a proof-first product leads with rows it has actually verified,
 * not the "Likely" leads it is not sure belong to the competitor. Verified
 * rows sort above every "Likely" row; within each tier the active-first /
 * longest-running order is preserved so the rest of the page reads the same.
 * Logged-in sessions keep `DEFAULT_SEARCH_RESULT_SORT` (active_first).
 */
export const ANONYMOUS_DEFAULT_SEARCH_RESULT_SORT: SearchResultSort =
  "verified_first";

export function parseSearchResultSort(value: string | null | undefined): SearchResultSort {
  if (
    value === "longest_running" ||
    value === "newest" ||
    value === "active_first" ||
    value === "verified_first"
  ) {
    return value;
  }
  return DEFAULT_SEARCH_RESULT_SORT;
}

/**
 * Default display order: active before inactive, then longest-running first.
 * Used for featured-proof selection and the Active-first sort option.
 */
export function compareAdsActiveFirstThenLongevity(left: AdRecord, right: AdRecord): number {
  if (left.active !== right.active) {
    return left.active ? -1 : 1;
  }
  return compareLongevityDesc(left, right);
}

/**
 * Verified-first ordering for the anonymous /search default (issue #2289).
 * Every verified row sorts above every "Likely" row, which sorts above every
 * "Unmatched" row; within a tier the active-first / longest-running order is
 * preserved so the rest of the page reads the same as the signed-in default.
 * Rows with no `domainMatch` metadata (legacy/non-v2 results) sort last,
 * unchanged from their relative order — they carry no tier to promote.
 */
export function compareAdsVerifiedFirstThenActive(left: AdRecord, right: AdRecord): number {
  const leftTier = resolveVerifiedFirstTierRank(left);
  const rightTier = resolveVerifiedFirstTierRank(right);
  if (leftTier !== rightTier) {
    return leftTier - rightTier;
  }
  return compareAdsActiveFirstThenLongevity(left, right);
}

/**
 * Tier rank for verified-first sort: 0 = verified, 1 = likely, 2 = unmatched.
 * Rows with no `domainMatch` metadata share the unmatched rank (2) so legacy
 * results keep their relative order instead of being promoted above real
 * likely/unmatched rows.
 */
function resolveVerifiedFirstTierRank(ad: AdRecord): number {
  if (!ad.domainMatch) return 2;
  const tier = domainMatchTier(ad.domainMatch.level);
  if (tier === "verified") return 0;
  if (tier === "likely") return 1;
  return 2;
}

export function compareAdsBySearchSort(left: AdRecord, right: AdRecord, sort: SearchResultSort): number {
  if (sort === "newest") {
    return compareFirstSeenDesc(left, right);
  }
  if (sort === "longest_running") {
    return compareLongevityDesc(left, right);
  }
  if (sort === "verified_first") {
    return compareAdsVerifiedFirstThenActive(left, right);
  }
  return compareAdsActiveFirstThenLongevity(left, right);
}

export function sortAdsForSearchDisplay(ads: AdRecord[], sort: SearchResultSort = DEFAULT_SEARCH_RESULT_SORT) {
  return [...ads].sort((left, right) => compareAdsBySearchSort(left, right, sort));
}

/** Prefer the first active ad when auto-selecting featured proof. */
export function pickFeaturedProofAd(ads: AdRecord[]): AdRecord | null {
  if (ads.length === 0) {
    return null;
  }
  const ordered = sortAdsForSearchDisplay(ads, "active_first");
  return ordered[0] ?? null;
}

function compareLongevityDesc(left: AdRecord, right: AdRecord) {
  const leftMs = parseTime(left.firstSeenAt);
  const rightMs = parseTime(right.firstSeenAt);
  if (leftMs === null && rightMs === null) {
    return 0;
  }
  if (leftMs === null) {
    return 1;
  }
  if (rightMs === null) {
    return -1;
  }
  // Earlier firstSeenAt = longer running
  return leftMs - rightMs;
}

function compareFirstSeenDesc(left: AdRecord, right: AdRecord) {
  const leftMs = parseTime(left.firstSeenAt);
  const rightMs = parseTime(right.firstSeenAt);
  if (leftMs === null && rightMs === null) {
    return 0;
  }
  if (leftMs === null) {
    return 1;
  }
  if (rightMs === null) {
    return -1;
  }
  // Newer first
  return rightMs - leftMs;
}

function parseTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
