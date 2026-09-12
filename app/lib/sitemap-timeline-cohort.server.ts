/**
 * Read-only D1 adapter for the sitemap-timeline cohort (issue #1958, phase 1).
 *
 * Sibling mirror of `sneaker-resale-cohort.server.ts` (issue #1946): the tier
 * read queries the SAME `public_search` discovery cache rows the BET publisher
 * writes and only READS them.
 *
 * Two deliberate divergences (manager decisions, recorded for review):
 *   - NO `expires_at > now` SQL filter: calendly.com / adspyder.io have NO
 *     scheduled writer, so an expiry gate would find zero fresh rows at 04:00
 *     UTC and the freeze would persist. Row age surfaces via `cacheStatus`
 *     ("fresh" / "stale"); `hasCoverage` is computed regardless of expiry.
 *   - Candidate domains come from the indexable timeline sitemap set
 *     (`loadIndexableTimelineEntries`) instead of a seed list, applying the
 *     complete-proof gate + non-ad-destination gate + `SITEMAP_TIMELINE_PATH_LIMIT`
 *     bound for free.
 *   - Issue #3095: when a cached payload's ads carry no domainMatch coverage
 *     (legacy pre-enrichment rows), the verified-link rule the /ads page gate
 *     already trusts (adHasVerifiedDomainLink, issue #1442) is the fall-back
 *     evidence read — the same trust standard, so the cohort mirrors the
 *     /ads indexable set instead of a narrower domainMatch-only slice.
 *
 * Honesty contract: no live provider calls; missing D1 → empty `Map` / `[]`
 * (degrade, never throw); `route_context = 'public_search'` and
 * `country = 'all'` only; demo payloads skipped; provider rollover =
 * most-recent-fetched wins with fall-through to the next-newest non-demo row.
 */

import { adHasVerifiedDomainLink } from "~/lib/brand-page.server";
import { queryIn } from "~/lib/data/d1.server";
import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import type { AdRecord } from "~/lib/types";
import type { AppEnv } from "~/lib/env.server";
import { resolveSeedList } from "~/lib/ads-domain-publisher.server";
import { SNEAKER_RESALE_SEED_LIST } from "~/lib/sneaker-resale-backfill.server";
import { loadIndexableBrandPageEntries, loadIndexableTimelineEntries } from "~/lib/sitemap.server";
import {
  canonicalizeSitemapTimelineDomain,
  countSitemapTimelineTier,
  timelineDomainsFromSitemapEntries,
  type SitemapTimelineTier,
} from "./sitemap-timeline-cohort";

/**
 * Provider values the publisher may have used to write the row. Same
 * enumeration as the sneaker adapter so a future provider addition only
 * requires extending this array (and not a LIKE pattern).
 */
const CACHE_KEY_PROVIDERS = [
  "meta_api",
  "meta_library_browser",
  "demo",
] as const;

const SITEMAP_CACHE_KEY_DOMAIN_SEGMENT_INDEX = 2;

interface DiscoveryCacheRow {
  cache_key: string;
  payload_json: string;
  fetched_at: string;
  expires_at: string;
}

interface AdvertiserPayloadShape {
  ads?: ReadonlyArray<{
    domainMatch?: { level?: unknown } | null;
    landingPageUrl?: unknown;
  }>;
  source?: unknown;
  provider?: unknown;
}

/**
 * Read the bounded candidate set of timeline domains. Issue #2021 widened the
 * source from the capture-backed timeline sitemap (a bootstrap trap: only
 * domains that already have captures were captured again) to the full tracked
 * /ads cohort (`loadIndexableBrandPageEntries`) — every tracked brand whose
 * landing page is watchable accumulates dated offer states. Coverage still
 * applies downstream: the tier lookup (verified/likely `public_search`
 * coverage) and `deriveSitemapTimelineCohort` gate which candidates actually
 * get captured, and `SITEMAP_TIMELINE_COHORT_CAP` bounds nightly spend.
 * Missing DB → `[]` (degrade, never throw).
 */
export async function loadSitemapTimelineCandidateDomains(
  env: AppEnv,
): Promise<string[]> {
  if (!env?.DB) {
    return [];
  }
  const [brandEntries, timelineEntries] = await Promise.all([
    loadIndexableBrandPageEntries(env),
    loadIndexableTimelineEntries(env),
  ]);
  // Capture-backed timeline domains first (they carry an honest lastmod),
  // then the tracked /ads cohort: rewrite each `/ads/:domain` entry to the
  // equivalent `/timeline/:domain` shape so the shared path extractor
  // (dedupe + canonicalize, never guessing) applies unchanged.
  const adsAsTimeline = brandEntries.map((entry) => ({
    path: entry.path.startsWith("/ads/")
      ? `/timeline/${entry.path.slice("/ads/".length)}`
      : entry.path,
  }));
  // Dedupe across both sources, capture-backed first-seen order preserved.
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const domain of [
    ...timelineDomainsFromSitemapEntries(timelineEntries),
    ...timelineDomainsFromSitemapEntries(adsAsTimeline),
  ]) {
    if (seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

/**
 * Build every plausible cache key the publisher could have written for the
 * given domains. Each domain maps to one cache key per provider value; the
 * adapter reads the union so a mid-run provider rollover still surfaces the
 * most recent row.
 */
function buildSitemapCacheKeyCandidates(domains: readonly string[]): string[] {
  const keys: string[] = [];
  for (const raw of domains) {
    const canonical = canonicalizeSitemapTimelineDomain(raw);
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
  const domain = parts[SITEMAP_CACHE_KEY_DOMAIN_SEGMENT_INDEX];
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
 * Read the most recent `public_search` discovery cache row per domain and
 * surface a `{ verified, likely, unmatched, hasCoverage, cacheStatus }`
 * snapshot. No expiry filter (manager decision — see module docblock): any
 * age of row is read; age surfaces as `cacheStatus`, coverage as
 * `hasCoverage`.
 *
 * Returns an empty `Map` when:
 *   - `env.DB` is missing (no D1 binding in this environment),
 *   - the domain list is empty,
 *   - the `discovery_cache_entry` table is absent (transient D1 / un-applied
 *     migration in a test environment).
 *
 * Per-domain tier counts are derived from the most recent `fetched_at` row
 * when multiple providers wrote one (provider rollover), skipping demo
 * payloads and falling through to the next-newest non-demo row.
 */
export async function getSitemapTimelineTierByDomain(
  env: AppEnv,
  domains: readonly string[],
): Promise<Map<string, SitemapTimelineTier>> {
  const result = new Map<string, SitemapTimelineTier>();
  if (!env?.DB || domains.length === 0) {
    return result;
  }

  const cacheKeys = buildSitemapCacheKeyCandidates(domains);
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
          AND cache_key IN (${placeholders})
      `,
      values: cacheKeys,
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
    // a fleet demo run must not discard a slightly older legitimate
    // commercial row for the same domain.
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
    let { verifiedCount, likelyCount, unmatchedCount } =
      countSitemapTimelineTier(levels);

    // Issue #3095 coverage fallback: many tracked /ads/* brands carry cached
    // ad payloads whose ads predate the search-v2 domainMatch enrichment
    // (meta_library_browser rows written before the enrichment shipped), so
    // the tier count above reads 0 verified / 0 likely even though the SAME
    // payload would back an indexable /ads/:domain page — that page's
    // populated-vs-thin gate (issue #1442) accepts verified-link evidence
    // straight from the ad's landing page URL, not only from domainMatch.
    // When no domainMatch-derived coverage exists, mirror that exact rule
    // (adHasVerifiedDomainLink) so the nightly cohort captures the tracked
    // /ads cohort the way the /ads sitemap already trusts it: same evidence
    // standard, so no phantom capture — a domain entering the cohort through
    // this fallback is the same set the /ads indexable gate lists.
    // DomainMatch-bearing payloads (search-v2 rows) are unaffected: they reach
    // hasCoverage above and never consult the fallback.
    if (verifiedCount + likelyCount === 0) {
      const fallbackVerified = (payload.ads ?? []).filter(
        (ad) => ad !== null && typeof ad === "object"
          ? adHasVerifiedDomainLink(ad as unknown as AdRecord, domain)
          : false,
      ).length;
      verifiedCount = fallbackVerified;
      unmatchedCount = (payload.ads ?? []).length - fallbackVerified;
    }

    result.set(domain, {
      verifiedCount,
      likelyCount,
      unmatchedCount,
      hasCoverage: verifiedCount + likelyCount >= 1,
      // Same lexical comparison the sneaker adapter's `expires_at > ?` SQL
      // gate would have applied to this row's stored text — so the verdict
      // never silently flips between the SQL world and this JS world.
      cacheStatus: pickedRow.expires_at > nowIso ? "fresh" : "stale",
    });
  }

  return result;
}

/**
 * Static exclusion set (no D1): the five demo brands (the demo-brand rail
 * already captures their timelines nightly) ∪ the domains of the
 * sneaker-resale seed list (the sneaker rail captures any covered seed
 * domain, and uncovered seed domains can never be sitemap candidates — no
 * proof rows — so excluding the whole seed set is airtight without a D1
 * read). Overlap with the demo set (nike.com is in both) collapses.
 * Canonicalized, deduped, deterministic order (demo brands first, then seed
 * list order). Phase 2 and later phases MUST reuse this exact function so
 * the exclusion never drifts silently.
 */
export function sitemapTimelineExcludedDomains(): string[] {
  const excluded = new Set<string>();
  for (const raw of DEMO_BRAND_PAGE_DOMAINS) {
    const canonical = canonicalizeSitemapTimelineDomain(raw);
    if (canonical) {
      excluded.add(canonical);
    }
  }
  const seedList = resolveSeedList(SNEAKER_RESALE_SEED_LIST);
  if (seedList && Array.isArray(seedList.domains)) {
    for (const entry of seedList.domains) {
      const canonical = canonicalizeSitemapTimelineDomain(entry?.domain);
      if (canonical) {
        excluded.add(canonical);
      }
    }
  }
  return [...excluded];
}