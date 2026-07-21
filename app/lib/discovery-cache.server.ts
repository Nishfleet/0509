import type { AppEnv } from "~/lib/env.server";
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

/**
 * Contract epoch for the advertiser evidence filter (PR #376). Every discovery
 * cache WRITE stamps this value into the payload
 * (`payload.discoveryFilterEpoch`), and the read-side choke point rejects any
 * advertiser/domain-mode ZERO-result entry that does not carry the CURRENT
 * epoch.
 *
 * Why an epoch and not a timestamp cutoff: worker version cannot be inferred
 * from fetchedAt. Cloudflare Workflow instances are version-pinned and may
 * sleep or retry indefinitely (per Cloudflare's documented limits and
 * sleeping/retrying semantics), so an instance running the BROKEN filter can
 * legitimately wake and write a wrong zero-result entry hours or days after
 * the fixed worker went live — later than any safe fixed cutoff. Only a
 * writer-stamped contract version proves which code produced the entry.
 *
 * Consequences by entry shape:
 * - advertiser/domain zero WITHOUT the current epoch (all pre-fix writes, and
 *   any late write from an old pinned instance): rejected -> fresh re-scrape.
 * - advertiser/domain zero WITH the current epoch: trusted.
 * - non-zero results: never gated (the broken filter could only wrongly EMPTY
 *   a result, never wrongly fill one).
 * - keyword-mode zeros: never gated (keyword search never ran the filter).
 *
 * Bump this value whenever the advertiser evidence-filter contract changes in
 * a way that invalidates previously cached zero results.
 */
export const DISCOVERY_ADVERTISER_FILTER_EPOCH = "advertiser-evidence-filter-v1";

/**
 * Strip writer-contract internals from a cached payload before it is served
 * anywhere outside the cache row itself. The epoch is a persistence-layer
 * fact (which filter contract wrote this row); it must never leak into
 * SearchResponse objects returned to routes, API surfaces, or callers — they
 * would otherwise serialize an internal versioning field to customers.
 */
export function toServableDiscoveryPayload<T extends { discoveryFilterEpoch?: string }>(
  payload: T,
): Omit<T, "discoveryFilterEpoch"> {
  const { discoveryFilterEpoch: _internalWriterEpoch, ...servable } = payload;
  return servable;
}

/**
 * The search modes whose zero-result caches the broken advertiser filter could
 * corrupt. Keyword mode is deliberately excluded — it never ran the filter.
 */
const BROKEN_ADVERTISER_FILTER_MODES = new Set<string>(["advertiser", "domain"]);

/**
 * True when a cache entry holds zero ads for an affected query mode and does
 * NOT carry the current writer epoch — i.e. it was written under an older (or
 * unknown) filter contract and must be re-scraped rather than served. Non-zero
 * results and keyword-mode zeros are never affected. fetchedAt is deliberately
 * NOT an input: recency proves nothing about writer version.
 */
export function isStaleZeroResultDiscoveryCacheEntry(input: {
  adCount: number;
  mode: string;
  filterEpoch: string | null | undefined;
}): boolean {
  if (!BROKEN_ADVERTISER_FILTER_MODES.has(input.mode)) return false;
  if (input.adCount > 0) return false;
  return input.filterEpoch !== DISCOVERY_ADVERTISER_FILTER_EPOCH;
}

export interface DiscoveryCacheReadOnlyLookup {
  provider: string;
  fingerprint: string;
  country: string;
  cursor?: string | null;
  /** Exact cache key (e.g. a search-v2 domain key). Wins over the fingerprint triple. */
  cacheKeyOverride?: string | null;
}

/**
 * Cache-READ-ONLY discovery lookup for zero-cost public surfaces
 * (e.g. /ads/:domain brand pages).
 *
 * Reads one `discovery_cache_entry` row by provider/fingerprint/country (or an
 * exact key override) and returns it — expired or not — so callers can label
 * freshness honestly. It NEVER falls through to a live provider: no Browser
 * Rendering, no Meta API, no lease acquisition, no provider-state writes.
 * Callers that need live data must go through `searchAdsViaSourceResolver`.
 */
export async function readDiscoveryCacheEntryCacheOnly(
  env: AppEnv,
  lookup: DiscoveryCacheReadOnlyLookup,
) {
  if (!env.DB) {
    return null;
  }

  const cacheKey =
    lookup.cacheKeyOverride ??
    buildDiscoveryCacheKey({
      provider: lookup.provider,
      fingerprint: lookup.fingerprint,
      country: lookup.country,
      cursor: lookup.cursor,
    });
  const { getDiscoveryCacheEntry } = await import("~/lib/data.server");
  const entry = await getDiscoveryCacheEntry(env, cacheKey);
  if (!entry) {
    return null;
  }
  // Writer-contract internals stay in the persisted row only.
  return { ...entry, payload: toServableDiscoveryPayload(entry.payload) };
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
