import type { ScheduledScanCadence } from "~/lib/plan-entitlements";
import type { DiscoveryRouteContext } from "~/lib/types";

export function buildDiscoveryCacheKey(input: {
  provider: string;
  fingerprint: string;
  country: string;
  cursor?: string | null;
}) {
  return [
    input.provider.trim().toLowerCase(),
    input.fingerprint.trim(),
    input.country.trim().toLowerCase().replace(/\s+/g, "-"),
    (input.cursor ?? "page-1").trim(),
  ].join(":");
}

export function resolveDiscoveryCacheTtlMs(routeContext: DiscoveryRouteContext) {
  return routeContext === "public_search"
    ? 15 * 60 * 1000
    : 24 * 60 * 60 * 1000;
}

/**
 * WP-36: scheduled scans may reuse any shared discovery_cache_entry younger
 * than the plan's scan cadence (cross-workspace). Interactive search is
 * unaffected — it still uses forceLive / expiresAt rules only.
 *
 * Free weekly watch: the 7-day window means a free scan of any competitor a
 * paid workspace already watches is a pure cache hit — near-zero marginal
 * Browser Rendering cost.
 */
export function resolveScheduledScanCacheMaxAgeMs(
  cadence: ScheduledScanCadence,
): number | null {
  if (cadence === "every_3h") return 3 * 60 * 60 * 1000;
  if (cadence === "every_6h") return 6 * 60 * 60 * 1000;
  if (cadence === "weekly") return 7 * 24 * 60 * 60 * 1000;
  return null;
}

export function isDiscoveryCacheWithinMaxAge(
  fetchedAt: string,
  maxAgeMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return false;
  return nowMs - fetchedMs <= maxAgeMs;
}

const SCHEDULED_DISCOVERY_CONTEXTS = new Set<DiscoveryRouteContext>([
  "watchlist_scan",
  "scheduled_warmup",
]);

/**
 * FIX-1: public_search (deep interactive) and scheduled scan/warmup (shallow)
 * share a fingerprint cache key but must not serve each other.
 */
export function isDiscoveryCacheRouteCompatible(
  requestContext: DiscoveryRouteContext,
  entryContext: string | null | undefined,
): boolean {
  const entry = (entryContext ?? "").trim() as DiscoveryRouteContext;
  const requestIsScheduled = SCHEDULED_DISCOVERY_CONTEXTS.has(requestContext);
  const entryIsScheduled = SCHEDULED_DISCOVERY_CONTEXTS.has(entry);
  if (requestIsScheduled) {
    return entryIsScheduled;
  }
  // Interactive public search only accepts other public_search entries.
  if (requestContext === "public_search") {
    return entry === "public_search";
  }
  // Unknown future contexts: require exact match.
  return entry === requestContext;
}
