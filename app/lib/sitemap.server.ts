/**
 * Dynamic sitemap entries for indexable /ads/:domain brand pages and
 * /timeline/:domain offer timelines.
 *
 * The static sitemap in app/lib/seo.ts deliberately lists no /ads/* path —
 * the set must be dynamic. This module generates it from existing
 * `discovery_cache_entry` rows at sitemap-render time, following the
 * strategy documented above SITEMAP_XML in app/lib/seo.ts:
 *
 *   1. Only rows that WOULD RENDER the indexable brand-page state qualify:
 *      - public_search route context (scheduled scan/warmup entries are
 *        shallow and never back a public page),
 *      - written by the RESOLVED commercial discovery provider — the page's
 *        loader reads only that provider's rows, so a row from any other
 *        provider would render the noindex shell while the sitemap claimed
 *        an indexable page,
 *      - non-demo provider AND payload (sample data is never presented as a
 *        brand's real ads on a public page),
 *      - ads present in the payload (a zero-row would render the honest
 *        "haven't checked recently" shell, which self-noindexes),
 *      - fetched_at within the 7-day freshness window
 *        (BRAND_PAGE_FRESH_FOR_INDEXING_MS) — older captures render with an
 *        honest freshness line but must not rank,
 *      - the capture's Ad Aggression Score would render (at least one
 *        verified-linked ad AND an observed window clearing the 14-day
 *        floor) — the score is the page's named differentiator, so a row
 *        whose page would ship the ad wall without it backs indexable thin
 *        content. The loader self-noindexes such a page; this gate keeps it
 *        out of the sitemap so the two agree.
 *   2. Domain recovery is strictly lossless-only: a row maps to a brand page
 *      ONLY when its cache key or payload carries the registrable domain
 *      (search-v2 domain keys embed it; v2 payloads carry searchIntent +
 *      displayDomain). Legacy fingerprint keys are un-mappable and skipped —
 *      we never guess a domain.
 *   3. Lookup parity: the listed domain must be reachable through the EXACT
 *      cache key the page will read. deriveBrandPageLookupForCountry
 *      reproduces the loader's own key derivation (search-v2 domain keys or
 *      legacy fingerprint triples, per the SEARCH_ROLLOUT_MODE posture), and
 *      only rows whose cache_key matches one of those derived keys qualify.
 *      This closes the stale-payload hole: a legacy-keyed row is never
 *      trusted on its payload's displayDomain alone — the key fingerprint
 *      must actually be the one the page derives for that domain.
 *   4. Country scopes are restricted to what every visitor lookup tries
 *      regardless of geo ("all", "United States"): the loader probes
 *      [visitor-country, all, United States] and cannot know a crawler's
 *      geo at sitemap time. A domain backed only by other-country captures
 *      renders the noindex shell for most crawlers, so it stays out of the
 *      sitemap by design — coverage is traded for the noindex guarantee.
 *   5. The emergency brake PUBLIC_BRAND_PAGES_INDEXABLE="0" (noindex on
 *      every /ads/* page) suppresses dynamic entries entirely, and demo
 *      provider environments (no real cache to render) are skipped too, so
 *      the sitemap can never list a page that serves noindex.
 *   6. This is a bounded cache read only — sitemap generation never triggers
 *      live discovery, Browser Rendering, or any paid operation.
 *
 * The sitemap also appends dynamic /timeline/:domain entries (the Offer
 * Timeline) from `landing_page_snapshot` rows, with its own rules below
 * (SITEMAP_TIMELINE_PATH_LIMIT and indexableTimelineEntriesFromRows):
 *
 *   7. A domain qualifies only when /timeline/:domain WOULD RENDER the
 *      indexable ledger state — at least one stored snapshot that survives
 *      the loader's proof gate (both screenshot and page-text artifacts,
 *      issue #1284). A domain whose rows all fail the gate renders empty
 *      (gone/noindex), so it stays out.
 *   8. Domain recovery is lossless-only: the registrable domain of a row's
 *      canonical_url hostname, gated by the same normalizeBrandPageDomain the
 *      route applies to its :domain param — a domain the route would 404 on
 *      (reserved TLDs, single labels, IPs) is never listed.
 *   9. No freshness window: unlike brand pages (7-day rule), the timeline
 *      ledger's only indexability rule is the empty-ledger one, so any
 *      proof-complete capture age qualifies.
 *   10. The PUBLIC_BRAND_PAGES_INDEXABLE brake does NOT suppress timeline
 *      entries — the timeline route never reads that env, so its pages stay
 *      indexable under the brake; mirroring the loader means timeline locs
 *      stay live (the brand /ads/* entries below are the ones it kills).
 *   11. Same zero-cost rule: one bounded D1 read at sitemap-render time.
 *      Missing landing_page_snapshot table on a fresh D1 degrades to the
 *      static sitemap, never a 500.
 */

import {
  adHasVerifiedDomainLink,
  computeBrandPageAggressionScore,
  deriveBrandPageLookupForCountry,
  normalizeBrandPageDomain,
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
} from "~/lib/brand-page.server";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import { snapshotRowHasCompleteProof, type LandingPageSnapshotRow } from "~/lib/offer-timeline.server";
import { shouldApplySearchV2 } from "~/lib/search-rollout.server";
import { registrableDomainFromHostname } from "~/lib/search-query";
import { renderSitemapXml, SITEMAP_STATIC_ENTRIES, type SitemapEntry } from "~/lib/seo";
import type { AdRecord } from "~/lib/types";

/**
 * Hard bound on dynamic brand-page entries per sitemap render. Keeps the
 * D1 read, the payload parsing, and the sitemap itself bounded (Google's
 * limit is 50k URLs per sitemap — 500 fresh brand pages is a deliberate
 * crawl-budget ceiling for this acquisition channel).
 */
export const SITEMAP_BRAND_PATH_LIMIT = 500;

/**
 * Hard bound on dynamic /timeline/:domain entries per sitemap render, next
 * to the brand-page bound above. Same rationale: keeps the D1 read and the
 * sitemap bounded (500 timelines is the same crawl-budget ceiling).
 */
export const SITEMAP_TIMELINE_PATH_LIMIT = 500;

/**
 * Country scopes the brand-page loader probes for EVERY visitor regardless of
 * geo (candidateCountries always appends "all" and "United States" to the
 * visitor's own country). Only captures under these scopes can back an
 * indexable render for an unknown crawler, so only they qualify for the
 * sitemap — see rule 4 in the module docblock.
 */
export const SITEMAP_ALWAYS_TRIED_COUNTRY_SCOPES: readonly string[] = [
  ALL_COUNTRIES_VALUE,
  "United States",
];

/** Subset of discovery_cache_entry columns the sitemap read needs. */
export interface SitemapCacheRow {
  cache_key: string;
  provider: string;
  route_context: string;
  payload_json: string;
  fetched_at: string;
}

/** Tolerant parse of the cached SearchResponse — only the fields we read. */
interface SitemapCachePayload {
  ads: unknown[];
  source?: unknown;
  provider?: unknown;
  searchIntent?: unknown;
  displayDomain?: unknown;
}

function parseSitemapCachePayload(value: string): SitemapCachePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (!Array.isArray(candidate.ads)) {
    return null;
  }
  return candidate as unknown as SitemapCachePayload;
}

function nonDemoAdsFromPayload(payload: SitemapCachePayload): unknown[] {
  return payload.ads.filter((ad) => ad && (ad as { source?: unknown }).source !== "demo");
}

/**
 * Recover the registrable brand domain a cache row maps to, or null when the
 * row cannot be losslessly mapped to an /ads/:domain page:
 * - search-v2 domain keys embed the domain and the search scope:
 *   `search-v2:domain:<registrable-domain>:<scope>:<provider>:<country>:<cursor>`.
 *   Only `exact` scope qualifies — the brand-page loader derives its lookup
 *   key with scope "exact" (deriveCacheLookup in brand-page.server.ts), so a
 *   broader row would render the noindex shell, never an indexable page.
 * - v2 payloads (including v2 rows stored under legacy-shaped keys) carry
 *   `searchIntent: "domain"` + `displayDomain`.
 * - legacy fingerprint keys carry no recoverable domain — skipped, never
 *   guessed.
 * The candidate always goes through the same `normalizeBrandPageDomain` the
 * route uses, so anything the page would 404 on is excluded here.
 */
export function brandDomainFromSitemapCacheRow(row: SitemapCacheRow): string | null {
  const keyParts = row.cache_key.split(":");
  if (keyParts[0] === "search-v2" && keyParts[1] === "domain") {
    // The key embeds the registrable domain and the search scope:
    // `search-v2:domain:<registrable-domain>:<scope>:<provider>:<country>:<cursor>`.
    // Only `exact` scope qualifies — the brand-page loader derives its lookup
    // key with scope "exact" (deriveCacheLookup in brand-page.server.ts), so a
    // broader row would render the noindex shell, never an indexable page.
    // Explicitly NOT falling through to the payload below: the scope in the
    // key is the authoritative render-scope fact.
    if (keyParts[3] !== "exact" || !keyParts[2]) {
      return null;
    }
    return normalizeBrandPageDomain(keyParts[2])?.domain ?? null;
  }

  // Legacy-shaped keys carry no scope; a v2 payload on such a row is the only
  // lossless signal (legacy fingerprint keys have no recoverable domain and
  // are skipped — never guessed).
  const payload = parseSitemapCachePayload(row.payload_json);
  if (payload?.searchIntent === "domain") {
    const display = payload.displayDomain;
    if (typeof display === "string" && display.trim()) {
      return normalizeBrandPageDomain(display)?.domain ?? null;
    }
  }

  return null;
}

/**
 * Mirror of the brand-page loader's indexability rules (toUsableSnapshot in
 * brand-page.server.ts): the row must render the indexable page state, not a
 * noindex variant. route_context/provider/age are also filtered in SQL — the
 * JS mirror keeps the pure core independently correct and testable.
 */
export function isIndexableBrandPageRow(row: SitemapCacheRow, now: Date): boolean {
  if (row.route_context !== "public_search") {
    return false;
  }
  if (row.provider === "demo") {
    return false;
  }

  const payload = parseSitemapCachePayload(row.payload_json);
  if (!payload) {
    return false;
  }
  // Never present demo/sample data as a brand's real ads on a public page.
  if (payload.source === "demo" || payload.provider === "demo") {
    return false;
  }
  const ads = nonDemoAdsFromPayload(payload);
  if (ads.length === 0) {
    return false;
  }

  const fetchedMs = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetchedMs)) {
    return false;
  }
  const ageMs = now.getTime() - fetchedMs;
  return ageMs >= 0 && ageMs <= BRAND_PAGE_FRESH_FOR_INDEXING_MS;
}

/**
 * Mirror of the brand-page loader's aggression-score gate. The page's named
 * differentiator (the Ad Aggression Score + its four public sub-scores:
 * Velocity/Testing/Freshness/Persistence) renders ONLY when the capture has
 * at least one verified-linked ad AND the observed window clears the 14-day
 * floor — `computeBrandPageAggressionScore` returns null otherwise. A row
 * whose page would ship the ad wall without the score backs an indexable
 * thin page; it must stay out of the sitemap so no indexable thin brand
 * page remains. The wall still renders for a direct visitor (the loader
 * only withholds indexability) — this gate keeps such pages out of the
 * sitemap, mirroring the loader's `aggression === null → noindex` rule.
 *
 * The ads are read from the cached payload as-is (the cache stores full
 * AdRecord objects); `computeBrandPageAggressionScore` returns null on any
 * missing field, so a partial/payload-shape ad degrades to "not listable"
 * rather than a false positive.
 */
export function brandPageRowRendersAggressionScore(
  row: SitemapCacheRow,
  domain: string,
  now: Date,
): boolean {
  const payload = parseSitemapCachePayload(row.payload_json);
  if (!payload) {
    return false;
  }
  const ads = nonDemoAdsFromPayload(payload);
  const verifiedLinkedAds = ads.filter((ad) =>
    adHasVerifiedDomainLink(ad as AdRecord, domain),
  );
  if (verifiedLinkedAds.length === 0) {
    return false;
  }
  return computeBrandPageAggressionScore(verifiedLinkedAds as AdRecord[], now) !== null;
}

/**
 * The exact discovery-cache keys the /ads/:domain page reads for this domain,
 * under the given provider and rollout posture, restricted to the
 * always-tried country scopes. A row qualifies for the sitemap only when its
 * cache_key is one of these — proof the public page will actually FIND (and
 * render indexable from) this row, not merely that a row exists.
 */
export function brandPageLookupCacheKeysForSitemap(
  provider: string,
  domain: string,
  useDomainV2: boolean,
): Set<string> {
  const keys = new Set<string>();
  for (const country of SITEMAP_ALWAYS_TRIED_COUNTRY_SCOPES) {
    keys.add(deriveBrandPageLookupForCountry(provider, domain, country, useDomainV2).cacheKey);
  }
  return keys;
}

/**
 * Options narrowing `indexableBrandPageEntriesFromRows` to rows the public page
 * can actually reach. Both mirror env-resolved facts at sitemap-render time:
 * - provider: resolveCommercialDiscoveryProvider(env) — the only provider the
 *   brand-page loader ever reads.
 * - useDomainV2: shouldApplySearchV2(env) — decides whether the loader derives
 *   search-v2 domain keys or legacy fingerprint triples. When omitted, the v2
 *   key shape is assumed (the pure core stays independently usable).
 */
export interface IndexableBrandPageRowOptions {
  provider?: string;
  useDomainV2?: boolean;
}

/**
 * Pure core: reduce cache rows (ordered newest-first) to deduped, bounded
 * /ads/:domain sitemap entries that the brand page would both find and render
 * indexable. Each entry carries a `lastmod` derived from the cache row's
 * `fetched_at` (the honest freshness signal — when we last saw real ads for
 * this brand) plus `changefreq=weekly` and `priority=0.6` (brand pages are
 * secondary to the funnel but worth periodic re-crawl). Kept separate from
 * the D1 read so the filtering rules are unit-testable without a database.
 */
export function indexableBrandPageEntriesFromRows(
  rows: readonly SitemapCacheRow[],
  now: Date = new Date(),
  options: IndexableBrandPageRowOptions = {},
): SitemapEntry[] {
  const seen = new Set<string>();
  const entries: SitemapEntry[] = [];
  for (const row of rows) {
    if (!isIndexableBrandPageRow(row, now)) {
      continue;
    }
    // The page reads only the resolved provider's rows; anything else would
    // render the noindex shell while the sitemap claimed an indexable page.
    if (options.provider !== undefined && row.provider !== options.provider) {
      continue;
    }
    const domain = brandDomainFromSitemapCacheRow(row);
    if (!domain || seen.has(domain)) {
      continue;
    }
    // Lookup parity: the row's key must be exactly what the page derives for
    // this domain under the current rollout posture and an always-tried
    // country scope — otherwise the page misses it and serves noindex.
    const lookupKeys = brandPageLookupCacheKeysForSitemap(
      options.provider ?? row.provider,
      domain,
      options.useDomainV2 ?? true,
    );
    if (!lookupKeys.has(row.cache_key)) {
      continue;
    }
    // The page's differentiator (Ad Aggression Score + 4 sub-scores) must
    // render, or the loader self-noindexes the page — never list a thin
    // page (ad wall without its score) in the sitemap. Mirrors the loader's
    // `aggression === null → noindex` rule so the sitemap and the live page
    // agree on indexability.
    if (!brandPageRowRendersAggressionScore(row, domain, now)) {
      continue;
    }
    seen.add(domain);
    const fetchedDate = row.fetched_at.slice(0, 10);
    const payload = parseSitemapCachePayload(row.payload_json);
    const adCount = payload ? nonDemoAdsFromPayload(payload).length : 0;
    entries.push({
      path: `/ads/${domain}`,
      lastmod: fetchedDate,
      changefreq: "weekly",
      priority: "0.6",
      adCount,
      fetchedAt: row.fetched_at,
    });
    if (entries.length >= SITEMAP_BRAND_PATH_LIMIT) {
      break;
    }
  }
  return entries;
}

/**
 * Read the bounded candidate set of indexable brand-page cache rows.
 * Cache-only: one SELECT, never a live-provider call. Any hiccup (missing
 * table on a fresh D1, unparseable rows) degrades to the static sitemap,
 * never a 500.
 */
export async function loadIndexableBrandPageEntries(
  env: AppEnv,
  now: Date = new Date(),
): Promise<SitemapEntry[]> {
  if (!env.DB) {
    return [];
  }

  // Mirror the loader's first gate: in demo-provider environments the brand
  // page renders the shell (noindex) regardless of any leftover rows.
  const { resolveCommercialDiscoveryProvider } = await import("~/lib/ad-source.server");
  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo") {
    return [];
  }
  // Emergency brake: every /ads/* page serves noindex — never sitemap it.
  if (env.PUBLIC_BRAND_PAGES_INDEXABLE?.trim() === "0") {
    return [];
  }

  // The rollout posture decides which key shape the page derives (search-v2
  // domain keys vs legacy fingerprint triples); the sitemap must mirror it or
  // it lists domains whose pages can never find their rows.
  const useDomainV2 = shouldApplySearchV2(env);

  const cutoffIso = new Date(now.getTime() - BRAND_PAGE_FRESH_FOR_INDEXING_MS).toISOString();
  try {
    const rows = await queryAll<SitemapCacheRow>(
      env,
      `
        SELECT cache_key, provider, route_context, payload_json, fetched_at
        FROM discovery_cache_entry
        WHERE route_context = 'public_search'
          AND provider = ?
          AND fetched_at >= ?
        ORDER BY fetched_at DESC
        LIMIT ?
      `,
      provider,
      cutoffIso,
      SITEMAP_BRAND_PATH_LIMIT,
    );
    return indexableBrandPageEntriesFromRows(rows, now, { provider, useDomainV2 });
  } catch (error) {
    if (isMissingSitemapTableError(error)) {
      return [];
    }
    throw error;
  }
}

/** Degrade to the static sitemap when a fresh D1 has no discovery cache table. */
function isMissingSitemapTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("no such table") &&
    message.includes("discovery_cache_entry")
  );
}

/**
 * Full production sitemap body: static funnel entries first (with changefreq
 * and priority), then the dynamic indexable brand-page entries (with lastmod
 * from their cache fetched_at), then the dynamic indexable /timeline/:domain
 * entries (with lastmod from their newest snapshot capture).
 */
export function buildSitemapXml(
  brandEntries: readonly SitemapEntry[],
  timelineEntries: readonly SitemapEntry[] = [],
): string {
  return renderSitemapXml([
    ...SITEMAP_STATIC_ENTRIES,
    ...brandEntries,
    ...timelineEntries,
  ]);
}

/**
 * Timeline sitemap entries (the Offer Timeline) — rules 7–11 of the module
 * docblock. Pure reduce lives here; the D1 read is `loadIndexableTimelineEntries`.
 */

/** Subset of landing_page_snapshot columns the sitemap timeline read needs. */
export interface TimelineSitemapRow {
  canonical_url: string;
  captured_at: string;
  artifact_key: string | null;
  metadata_json: string | null;
}

/**
 * Recover the /timeline/:domain a snapshot row backs, or null. Lossless-only,
 * mirroring the loader's own domain recovery: the registrable domain of the
 * row's canonical_url hostname (never guessed from the URL text), gated by the
 * same normalizeBrandPageDomain the timeline route applies to its :domain
 * param — a domain the route would 404 on (reserved TLDs like example.com,
 * single labels, IPs) is never listed.
 */
export function timelineDomainFromSnapshotRow(row: TimelineSitemapRow): string | null {
  let hostname: string;
  try {
    const url = new URL(row.canonical_url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    hostname = url.hostname.trim().toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  const registrable = registrableDomainFromHostname(hostname);
  if (!registrable) {
    return null;
  }
  return normalizeBrandPageDomain(registrable)?.domain ?? null;
}

/**
 * Pure core: reduce snapshot rows (ordered newest-first) to deduped, bounded
 * /timeline/:domain sitemap entries that the timeline route would render
 * indexable. A domain qualifies only when `loadOfferTimeline` would return at
 * least one ledger entry for it (entries.length > 0 is the loader's own
 * noindex predicate): at least one row whose canonical_url maps to the domain
 * AND survives the proof gate (screenshot + page-text artifacts stored, issue
 * #1284). No freshness window — unlike brand pages, the timeline ledger
 * renders indexable regardless of capture age. Each entry carries a `lastmod`
 * from the newest capture date for that domain plus changefreq=weekly and
 * priority=0.5 (timelines sit one level below the /ads/:domain brand page in
 * the funnel: 0.6 > 0.5 > the 0.3–0.4 boilerplate band). Kept separate from
 * the D1 read so the filtering rules are unit-testable without a database.
 */
export function indexableTimelineEntriesFromRows(
  rows: readonly TimelineSitemapRow[],
): SitemapEntry[] {
  const seen = new Set<string>();
  const entries: SitemapEntry[] = [];
  for (const row of rows) {
    const domain = timelineDomainFromSnapshotRow(row);
    if (!domain || seen.has(domain)) {
      continue;
    }
    // The loader's proof gate: a row without both artifacts is filtered out
    // of the ledger, so its domain would render empty (gone/noindex) and must
    // not be listed. `seen` is only marked once an entry is created, so a
    // later older row with complete proof still qualifies its domain.
    if (!snapshotRowHasCompleteProof(row)) {
      continue;
    }
    seen.add(domain);
    entries.push({
      path: `/timeline/${domain}`,
      lastmod: row.captured_at.slice(0, 10),
      changefreq: "weekly",
      priority: "0.5",
    });
    if (entries.length >= SITEMAP_TIMELINE_PATH_LIMIT) {
      break;
    }
  }
  return entries;
}

/**
 * Read the bounded candidate set of timeline snapshot rows. Cache-only: one
 * SELECT, never a live-provider call. Any hiccup (missing table on a fresh
 * D1, unparseable rows) degrades to the static sitemap, never a 500.
 *
 * Deliberately NOT suppressed by the PUBLIC_BRAND_PAGES_INDEXABLE brake: that
 * env noindexes /ads/* pages only, and the timeline route never reads it —
 * /timeline/:domain indexability is purely the empty-ledger rule above.
 * Mirroring the loader means timeline locs stay live under the brake (the
 * pages they point to still render indexable).
 */
export async function loadIndexableTimelineEntries(
  env: AppEnv,
): Promise<SitemapEntry[]> {
  if (!env.DB) {
    return [];
  }

  try {
    const rows = await queryAll<TimelineSitemapRow>(
      env,
      `
        SELECT canonical_url, captured_at, artifact_key, metadata_json
        FROM landing_page_snapshot
        WHERE artifact_key IS NOT NULL OR metadata_json IS NOT NULL
        ORDER BY captured_at DESC
        LIMIT ?
      `,
      SITEMAP_TIMELINE_PATH_LIMIT,
    );
    return indexableTimelineEntriesFromRows(rows);
  } catch (error) {
    if (isMissingTimelineTableError(error)) {
      return [];
    }
    throw error;
  }
}

/** Degrade to the static sitemap when a fresh D1 has no snapshot table. */
function isMissingTimelineTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("no such table") &&
    message.includes("landing_page_snapshot")
  );
}

/** Sitemap file shape consumed by workers/app.ts (publicSeoFileForPathname's). */
export async function publicSitemapFile(env: AppEnv): Promise<{
  body: string;
  contentType: string;
  cacheControl: string;
}> {
  const [brandEntries, timelineEntries] = await Promise.all([
    loadIndexableBrandPageEntries(env),
    loadIndexableTimelineEntries(env),
  ]);
  return {
    body: buildSitemapXml(brandEntries, timelineEntries),
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };
}
