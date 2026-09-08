import type { AdRecord } from "~/lib/types";

export type SearchResultSort = "active_first" | "longest_running" | "newest";

export const DEFAULT_SEARCH_RESULT_SORT: SearchResultSort = "active_first";

export function parseSearchResultSort(value: string | null | undefined): SearchResultSort {
  if (value === "longest_running" || value === "newest" || value === "active_first") {
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

export function compareAdsBySearchSort(left: AdRecord, right: AdRecord, sort: SearchResultSort): number {
  if (sort === "newest") {
    return compareFirstSeenDesc(left, right);
  }
  if (sort === "longest_running") {
    return compareLongevityDesc(left, right);
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
