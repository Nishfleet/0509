/**
 * Read-only D1 adapter for the sneaker-resale cohort (issue #1946, phase 1).
 *
 * The BET 5 publisher (`app/lib/ads-domain-publisher.server.ts`) writes one
 * `public_search` discovery cache row per published sneaker-resale brand
 * using the search-v2 domain key
 * `search-v2:domain:<domain>:exact:<provider>:all:page-1`. This adapter only
 * READS those rows back — it never INSERTs, UPDATEs, or DELETEs.
 *
 * Honesty contract (same shape as `runDemoBrandBackfill`):
 *   - No live provider calls. Cache-only. No Meta API, no Browser Rendering,
 *     no lease acquisition.
 *   - Missing D1 → empty `Map` (degrade, never throw). The nightly backfill
 *     (phase 2) treats an empty tier map the same way it treats a brand
 *     with no cache row: no capture, no phantom offer.
 *   - Expired rows (`expires_at <= now`) are excluded so a stale payload
 *     whose tier verdict no longer reflects a live discovery never adds a
 *     brand to the cohort.
 *   - `route_context = 'public_search'` only. `scheduled_warmup` /
 *     `watchlist_scan` rows are shallow and would inflate `unmatchedCount`
 *     — the publisher's loader (`isDiscoveryCacheRouteCompatible`) already
 *     rejects them on read; we mirror that filter here.
 *   - `country = 'all'` only. The publisher's `exact`+`all` scope is the
 *     one the /ads/:domain loader and the sitemap read.
 *   - `payload.source`/`payload.provider === 'demo'` rows are skipped —
 *     demo data must never back a public timeline.
 *   - Missing table on a transient D1 → empty `Map`. Same degrade-don't-
 *     throw contract as `runDemoBrandBackfill`'s missing-DB path.
 */

import { queryIn } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import {
  canonicalizeSneakerResaleDomain,
  countSneakerResaleTier,
  type SneakerResaleTier,
} from "./sneaker-resale-cohort";

/**
 * Provider values the publisher may have used to write the row. We
 * enumerate the three known `AdDiscoveryProvider` values so a future
 * provider addition only requires extending this array (and not the LIKE
 * pattern). With 25 seed domains × 3 providers = 75 cache keys per query —
 * well under D1's 90-bind cap.
 */
const CACHE_KEY_PROVIDERS = [
  "meta_api",
  "meta_library_browser",
  "demo",
] as const;

const SNEAKER_CACHE_KEY_SEGMENT_LOOKUP_DOMAIN_INDEX = 2;

interface DiscoveryCacheRow {
  cache_key: string;
  payload_json: string;
  fetched_at: string;
  expires_at: string;
}

interface AdvertiserPayloadShape {
  ads?: ReadonlyArray<{
    domainMatch?: { level?: unknown } | null;
  }>;
  source?: unknown;
  provider?: unknown;
}

/**
 * Build every plausible cache key the publisher could have written for the
 * given domains. Each domain maps to one cache key per provider value; the
 * adapter reads the union so a mid-run provider rollover (e.g. publisher
 * wrote with `meta_library_browser`, then switched to `meta_api`) still
 * surfaces the most recent fresh row.
 */
function buildSneakerCacheKeyCandidates(domains: readonly string[]): string[] {
  const keys: string[] = [];
  for (const raw of domains) {
    const canonical = canonicalizeSneakerResaleDomain(raw);
    if (!canonical) {
      continue;
    }
    for (const provider of CACHE_KEY_PROVIDERS) {
      keys.push(
        `search-v2:domain:${canonical}:exact:${provider}:all:page-1`,
      );
    }
  }
  return keys;
}

/**
 * Extract the canonical domain from a search-v2 cache key. The shape is
 * `search-v2:domain:<domain>:exact:<provider>:<country>:<cursor>`; anything
 * that does not match that shape is ignored.
 */
function extractDomainFromCacheKey(cacheKey: string): string | null {
  const parts = cacheKey.split(":");
  if (parts.length < 7) {
    return null;
  }
  if (parts[0] !== "search-v2" || parts[1] !== "domain") {
    return null;
  }
  if (parts[3] !== "exact" || parts[5] !== "all" || parts[6] !== "page-1") {
    return null;
  }
  const domain = parts[SNEAKER_CACHE_KEY_SEGMENT_LOOKUP_DOMAIN_INDEX];
  return domain && domain.length > 0 ? domain : null;
}

function isMissingDiscoveryCacheTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("no such table") && message.includes("discovery_cache_entry")
  );
}

function isDemoPayload(payload: AdvertiserPayloadShape): boolean {
  return payload.source === "demo" || payload.provider === "demo";
}

/**
 * Read the most recent non-expired `public_search` discovery cache row per
 * domain and surface a `{ verified, likely, hasCoverage }` snapshot.
 *
 * Returns an empty `Map` when:
 *   - `env.DB` is missing (no D1 binding in this environment),
 *   - the domain list is empty,
 *   - the `discovery_cache_entry` table is absent (transient D1 / un-applied
 *     migration in a test environment).
 *
 * Per-domain tier counts are derived from the most recent
 * `fetched_at` row when multiple providers wrote one (provider rollover).
 */
export async function getSneakerResaleTierByDomain(
  env: AppEnv,
  domains: readonly string[],
): Promise<Map<string, SneakerResaleTier>> {
  const result = new Map<string, SneakerResaleTier>();
  if (!env?.DB || domains.length === 0) {
    return result;
  }

  const cacheKeys = buildSneakerCacheKeyCandidates(domains);
  if (cacheKeys.length === 0) {
    return result;
  }

  const nowIso = new Date().toISOString();
  let rows: DiscoveryCacheRow[];
  try {
    rows = await queryIn<DiscoveryCacheRow>(env, {
      buildSql: (placeholders) => `
        SELECT cache_key, payload_json, fetched_at, expires_at
        FROM discovery_cache_entry
        WHERE route_context = 'public_search'
          AND country = 'all'
          AND expires_at > ?
          AND cache_key IN (${placeholders})
      `,
      values: cacheKeys,
      prefix: [nowIso],
    });
  } catch (error) {
    if (isMissingDiscoveryCacheTableError(error)) {
      return result;
    }
    throw error;
  }

  // Group rows by canonical domain; pick the most recently fetched row per
  // domain so a provider rollover surfaces the freshest payload.
  const rowsByDomain = new Map<string, DiscoveryCacheRow[]>();
  for (const row of rows) {
    const domain = extractDomainFromCacheKey(row.cache_key);
    if (!domain) {
      continue;
    }
    const bucket = rowsByDomain.get(domain);
    if (bucket) {
      bucket.push(row);
    } else {
      rowsByDomain.set(domain, [row]);
    }
  }

  for (const [domain, domainRows] of rowsByDomain) {
    domainRows.sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));

    // Fall through to the next-newest row when the newest is a demo payload:
    // a fleet demo run minutes before the rail must not discard a slightly
    // older but still-fresh legitimate commercial row for the same domain.
    let pickedRow: DiscoveryCacheRow | null = null;
    let payload: AdvertiserPayloadShape | null = null;
    for (const row of domainRows) {
      let candidate: AdvertiserPayloadShape;
      try {
        candidate = JSON.parse(row.payload_json) as AdvertiserPayloadShape;
      } catch {
        continue;
      }
      if (!candidate || typeof candidate !== "object") {
        continue;
      }
      if (isDemoPayload(candidate)) {
        continue;
      }
      pickedRow = row;
      payload = candidate;
      break;
    }
    if (!pickedRow || !payload) {
      continue;
    }

    const levels = (payload.ads ?? [])
      .map((ad) => (ad && typeof ad === "object" ? ad.domainMatch?.level : null))
      .filter((level): level is unknown => level !== undefined && level !== null)
      .map((level) => (typeof level === "string" ? level : ""));
    const { verifiedCount, likelyCount, unmatchedCount } =
      countSneakerResaleTier(levels);

    result.set(domain, {
      verifiedCount,
      likelyCount,
      unmatchedCount,
      hasCoverage: verifiedCount + likelyCount >= 1,
      cacheStatus: "fresh",
    });
  }

  return result;
}