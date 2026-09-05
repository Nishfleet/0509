/**
 * Scheduled refresh of the public /ads/:domain showcase.
 *
 * Why this exists: brand pages render ONLY from the existing
 * `discovery_cache_entry` rows tagged `route_context = 'public_search'`. The
 * six-hourly `runScheduledDiscoveryWarmup` only refreshes rows that back
 * ACTIVE WATCHLISTS — brand pages whose domain nobody watches never get
 * re-warmed and silently age through the freshness window. When 6 of 12
 * sitemap brand pages advertise "checked about 2 days ago" (still indexable,
 * still honest, but visibly stale to visitors and crawlers), the showcase is
 * decaying faster than the watchlist-based warmup can repair.
 *
 * This module adds a dedicated scheduled pass that:
 *
 *  1. Lists the current indexable brand pages via `loadIndexableBrandPagePaths`
 *     (same D1 read the sitemap already does — bounded, cache-only).
 *  2. For each path, reads the underlying cache row's `fetched_at` and picks
 *     the ones older than `BRAND_PAGE_REFRESH_STALE_AFTER_MS` (24h).
 *  3. Refreshes at most `BRAND_PAGE_REFRESH_MAX_PER_PASS` (12) targets per
 *     pass, oldest first — keeps the showcase inside the 7-day
 *     `BRAND_PAGE_FRESH_FOR_INDEXING_MS` window without exceeding the per-pass
 *     provider budget.
 *  4. Writes the new cache row via `searchAdsViaSourceResolver` with
 *     `purpose: "public_search"` so the resulting row keeps the brand-page
 *     loader's filter (`route_context === "public_search"`) AND keeps the
 *     row out of the watchlist telemetry stream (the resolver already
 *     segregates public_search from watchlist_scan/scheduled_warmup).
 *
 * ZERO-COST CONSTRAINT (preserved): this module NEVER triggers a public
 * brand-page render to refresh data — only the existing scheduled search
 * path. Public page reads stay cache-only as before.
 *
 * Bound to the dedicated `BRAND_PAGE_REFRESH_CRON` schedule; the worker
 * cron handler dispatches `runScheduledPublicBrandPageRefresh` exactly like
 * it dispatches `runScheduledDiscoveryWarmup`.
 */

import { searchAdsViaSourceResolver } from "~/lib/ad-source.server";
import { BRAND_PAGE_FRESH_FOR_INDEXING_MS, normalizeBrandPageDomain } from "~/lib/brand-page.server";
import type { AppEnv } from "~/lib/env.server";
import type { NormalizedSavedQuery } from "~/lib/types";

/** Cron expression for the dedicated brand-page-refresh schedule. */
export const BRAND_PAGE_REFRESH_CRON = "37 */12 * * *";

/**
 * Refresh any brand page whose underlying cache row is older than this.
 * 24 hours keeps the visible "checked about …" stamp inside the
 * same-day feel without spending provider budget on every six-hourly
 * warmup tick — the public_search TTL (15 min) and the indexing window
 * (7 days) bracket this comfortably.
 */
export const BRAND_PAGE_REFRESH_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Hard cap on refreshes per scheduled pass. Matches the visible-sitemap
 * envelope from the scout item (12 brand pages); keeps a single failure
 * surge from running away.
 */
export const BRAND_PAGE_REFRESH_MAX_PER_PASS = 12;

/** Hard cap on the underlying D1 read so a runaway cache can't blow the budget. */
const BRAND_PAGE_REFRESH_CANDIDATE_LIMIT = 64;

export interface BrandPageRefreshTarget {
  domain: string;
  /** ISO timestamp of the existing cache row's `fetched_at`. */
  fetchedAt: string;
  /** Age of the existing cache row at `now`. */
  ageMs: number;
}

export interface BrandPageRefreshCandidate {
  domain: string;
  fetchedAt: string;
  /** Underlying cache key written by `loadIndexableBrandPagePaths`. */
  cacheKey: string;
}

export interface BrandPageRefreshOutcome {
  attempted: number;
  succeeded: number;
  failed: number;
  /** Targets skipped because the underlying cache was still within the fresh window. */
  skippedFresh: number;
  /** Targets skipped because the per-pass cap was reached. */
  skippedBudget: number;
  /** Number of indexable brand pages observed (used for telemetry context). */
  observedIndexable: number;
}

/**
 * Pure core: given the raw candidates the D1 read returned, choose which
 * domains are stale enough to warrant a refresh this pass. Pure so the
 * selection rules are unit-testable without a database.
 *
 * Rules:
 *  - Deduplicate by domain (newest row wins; older rows are stale candidates).
 *  - Skip rows whose `fetched_at` is within `staleAfterMs` (fresh enough).
 *  - Sort ascending by `fetched_at` so the OLDEST cache row goes first.
 *  - Cap at `maxPerPass`.
 */
export function selectBrandPageRefreshTargets(
  candidates: readonly BrandPageRefreshCandidate[],
  options: { staleAfterMs: number; maxPerPass: number; now?: Date },
): BrandPageRefreshTarget[] {
  /** Dedup by domain; keep only the NEWEST row per domain. */
  const newestByDomain = new Map<string, BrandPageRefreshCandidate>();
  for (const candidate of candidates) {
    const previous = newestByDomain.get(candidate.domain);
    if (!previous || candidate.fetchedAt > previous.fetchedAt) {
      newestByDomain.set(candidate.domain, candidate);
    }
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const stale: BrandPageRefreshTarget[] = [];
  for (const candidate of newestByDomain.values()) {
    const fetchedMs = Date.parse(candidate.fetchedAt);
    if (!Number.isFinite(fetchedMs)) {
      continue;
    }
    const ageMs = nowMs - fetchedMs;
    if (ageMs <= options.staleAfterMs) {
      continue;
    }
    stale.push({
      domain: candidate.domain,
      fetchedAt: candidate.fetchedAt,
      ageMs,
    });
  }
  stale.sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt));
  return stale.slice(0, options.maxPerPass);
}

/**
 * Read the underlying cache rows for every indexable brand page and turn
 * them into refresh candidates. Re-queries D1 with the same SQL envelope
 * the sitemap uses (route_context = 'public_search', non-demo, recent
 * fetched_at) so we get the canonical cache key + the exact `fetched_at`.
 */
async function loadBrandPageRefreshCandidates(
  env: AppEnv,
  now: Date,
): Promise<BrandPageRefreshCandidate[]> {
  if (!env.DB) {
    return [];
  }
  const cutoffIso = new Date(
    now.getTime() - BRAND_PAGE_FRESH_FOR_INDEXING_MS,
  ).toISOString();
  try {
    const { queryAll } = await import("~/lib/data/d1.server");
    const rows = await queryAll<{ cache_key: string; fetched_at: string; payload_json: string }>(
      env,
      `
        SELECT cache_key, fetched_at, payload_json
        FROM discovery_cache_entry
        WHERE route_context = 'public_search'
          AND provider != 'demo'
          AND fetched_at >= ?
        ORDER BY fetched_at DESC
        LIMIT ?
      `,
      cutoffIso,
      BRAND_PAGE_REFRESH_CANDIDATE_LIMIT,
    );
    const candidates: BrandPageRefreshCandidate[] = [];
    for (const row of rows) {
      const domain = domainFromCacheKey(row.cache_key, row.payload_json);
      if (!domain) {
        continue;
      }
      candidates.push({
        domain,
        fetchedAt: row.fetched_at,
        cacheKey: row.cache_key,
      });
    }
    return candidates;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("no such table")) {
      return [];
    }
    throw error;
  }
}

/**
 * Lossless domain recovery from a `discovery_cache_entry` row — same logic
 * the sitemap uses (`brandDomainFromSitemapCacheRow`), reimplemented here as
 * a synchronous helper so this module doesn't pull in the sitemap module
 * (which would risk a circular D1 import in tests).
 *
 *  - search-v2 exact-scope keys: `search-v2:domain:<domain>:exact:<...>`.
 *  - legacy-shaped keys with v2 payload (`searchIntent: 'domain'` +
 *    `displayDomain`): the payload's `displayDomain` wins.
 *  - legacy fingerprint keys: skipped — no recoverable domain.
 */
function domainFromCacheKey(cacheKey: string, payloadJson: string): string | null {
  const parts = cacheKey.split(":");
  if (parts[0] === "search-v2" && parts[1] === "domain" && parts[3] === "exact" && parts[2]) {
    return normalizeBrandPageDomain(parts[2])?.domain ?? null;
  }
  try {
    const parsed = JSON.parse(payloadJson) as { searchIntent?: unknown; displayDomain?: unknown };
    if (parsed?.searchIntent === "domain" && typeof parsed.displayDomain === "string") {
      return normalizeBrandPageDomain(parsed.displayDomain.trim())?.domain ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Build the minimal v2 saved-query a refresh pass runs. The brand-page
 * loader uses the same shape (`deriveCacheLookup` in `brand-page.server.ts`),
 * so writing with this query lands a row that the loader's first cache
 * lookup hits, and the new row's `cache_key` matches the existing row's
 * key shape exactly. Refreshing with a different query would write a
 * parallel cache row the loader never reads.
 */
async function buildBrandPageRefreshQuery(
  domain: string,
  filters: NormalizedSavedQuery["filters"] | undefined,
): Promise<NormalizedSavedQuery> {
  const { parseSearchInputFromWebsiteField } = await import("~/lib/search-query");
  const { normalizeCompetitorWebsiteInput, applyWebsiteSearchFallback } = await import("~/lib/competitor-website");
  const { parseSearchParams } = await import("~/lib/normalize");
  const { buildSearchV2SavedQuery } = await import("~/lib/search-v2.server");
  const website = normalizeCompetitorWebsiteInput(domain);
  const fallback = applyWebsiteSearchFallback(
    parseSearchParams(new URLSearchParams(), { country: filters?.country ?? "all" }),
    website,
  );
  const queryIntent = parseSearchInputFromWebsiteField(domain);
  if (!queryIntent || queryIntent.intent !== "domain" || !queryIntent.registrableDomain) {
    throw new Error(`brand_page_refresh: cannot derive query intent for ${domain}`);
  }
  return buildSearchV2SavedQuery(queryIntent, "exact", fallback.filters);
}

/**
 * Run the scheduled brand-page refresh. Idempotent — re-runs only refresh
 * rows that are still stale at the time of the call. Safe to call from a
 * cron handler (returns synchronously, logs a single summary line).
 */
export async function runScheduledPublicBrandPageRefresh(
  env: AppEnv,
  options: { now?: Date; executionContext?: Pick<ExecutionContext, "waitUntil"> | null } = {},
): Promise<BrandPageRefreshOutcome> {
  const now = options.now ?? new Date();
  if (!env.DB) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skippedFresh: 0,
      skippedBudget: 0,
      observedIndexable: 0,
    };
  }

  const candidates = await loadBrandPageRefreshCandidates(env, now);
  const targets = selectBrandPageRefreshTargets(candidates, {
    staleAfterMs: BRAND_PAGE_REFRESH_STALE_AFTER_MS,
    maxPerPass: BRAND_PAGE_REFRESH_MAX_PER_PASS,
    now,
  });
  const skippedFresh = Math.max(0, candidates.length - targets.length);
  const skippedBudget = Math.max(0, candidates.length - BRAND_PAGE_REFRESH_MAX_PER_PASS - skippedFresh);

  let succeeded = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      const query = await buildBrandPageRefreshQuery(target.domain, undefined);
      // `forceLive: true` makes the resolver skip the cache read gate and
      // issue a fresh provider call so the row's `fetched_at` actually
      // moves. `purpose: "public_search"` keeps the new row inside the
      // brand-page loader's `route_context === "public_search"` filter, and
      // keeps the watchlist telemetry stream untouched.
      const response = await searchAdsViaSourceResolver(env, query, null, {
        purpose: "public_search",
        forceLive: true,
        executionContext: options.executionContext ?? null,
      });
      if (response && Array.isArray(response.ads)) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      console.warn("brand page refresh failed", {
        domain: target.domain,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  return {
    attempted: targets.length,
    succeeded,
    failed,
    skippedFresh,
    skippedBudget,
    observedIndexable: candidates.length,
  };
}
