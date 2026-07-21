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
 * Cutoff for the broken-advertiser-filter era (PR #376). Advertiser/domain-mode
 * searches scraped before the advertiser-fix deploy cached 0-ad results that are
 * now wrong, yet stay usable (discoveryEmptyReason "no_results") and can serve
 * for up to the cache TTL — 24h for scans, and up to a 7-day cadence window for
 * shared scheduled hits. A zero-result entry scraped before this instant is
 * treated as expired so the next read re-scrapes fresh.
 *
 * Bound to stable-deployment evidence PLUS the maximum old-code drain window:
 * in deploy run 29812131936 the fixed worker was uploaded at 08:13:55Z,
 * identified at 08:13:58Z, and serving stably on every production alias by
 * 08:14:30Z. The alias flip alone is NOT sufficient — a request served by the
 * broken worker (an in-flight HTTP request, or a version-pinned Workflow scan
 * instance started before the flip) can finish minutes-to-an-hour later and
 * WRITE a zero-result entry whose fetchedAt is after the flip. 12:00:00Z is
 * hours past any plausible drain (HTTP requests finish in minutes; scan
 * workflow instances in well under an hour), so no broken-worker write can
 * carry a post-cutoff fetchedAt. Cost of the wide window: a legitimate
 * new-worker zero written 08:15–12:00 pays one extra re-scrape — cheap, honest.
 *
 * Keyword-mode searches never applied the advertiser filter and were explicitly
 * unchanged by PR #376 — the invalidation is scoped to the affected query shape
 * (see isStaleZeroResultDiscoveryCacheEntry) and never expires keyword zeros.
 *
 * REMOVABLE after 2026-07-28: one full cache-TTL cycle (7-day max window) past
 * the fix deploy, every pre-fix zero-result entry has aged out on its own and
 * this override — plus its helper and tests — can be deleted.
 */
export const STALE_ZERO_RESULT_CUTOFF = "2026-07-21T12:00:00.000Z";
const STALE_ZERO_RESULT_CUTOFF_MS = Date.parse(STALE_ZERO_RESULT_CUTOFF);

/**
 * The search modes whose zero-result caches the broken advertiser filter could
 * corrupt. Keyword mode is deliberately excluded — it never ran the filter.
 */
const BROKEN_ADVERTISER_FILTER_MODES = new Set<string>(["advertiser", "domain"]);

/**
 * True when a cache entry holds zero ads for an affected query mode AND was
 * scraped before the advertiser-fix cutoff — i.e. a stale zero-result from the
 * broken-filter era that must be re-scraped rather than served. Non-zero
 * results, keyword-mode zeros, and any zero scraped at/after the cutoff are
 * never affected.
 */
export function isStaleZeroResultDiscoveryCacheEntry(input: {
  adCount: number;
  fetchedAt: string;
  mode: string;
}): boolean {
  if (!BROKEN_ADVERTISER_FILTER_MODES.has(input.mode)) return false;
  if (input.adCount > 0) return false;
  const fetchedMs = Date.parse(input.fetchedAt);
  // Unparseable timestamp: don't special-case — let normal expiry rules apply.
  if (!Number.isFinite(fetchedMs)) return false;
  return fetchedMs < STALE_ZERO_RESULT_CUTOFF_MS;
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
  return getDiscoveryCacheEntry(env, cacheKey);
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
