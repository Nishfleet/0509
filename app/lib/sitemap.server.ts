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
 *      - the capture carries at least one verified-linked ad (the page is
 *        populated, not thin). The Ad Aggression Score may still be deferred
 *        (observed window below the 14-day floor), but indexability is
 *        decoupled from score computability (issue #1442): a page with a
 *        real ad wall is indexable while the score card shows an honest
 *        "N/14 days so far" state. Only a wall with ZERO verified-linked ads
 *        backs indexable thin content, so those stay out — the loader
 *        self-noindexes them; this gate keeps them out of the sitemap so the
 *        two agree.
 *   2. Alias domains are never listed: the route 301-redirects them to their
 *      canonical (product) brand page, so they are no longer distinct
 *      indexable URLs (issue #1446 criterion 3).
 *   3. Domain recovery is strictly lossless-only: a row maps to a brand page
 *      ONLY when its cache key or payload carries the registrable domain
 *      (search-v2 domain keys embed it; v2 payloads carry searchIntent +
 *      displayDomain). Legacy fingerprint keys are un-mappable and skipped —
 *      we never guess a domain.
 *   5. Lookup parity: the listed domain must be reachable through the EXACT
 *      cache key the page will read. deriveBrandPageLookupForCountry
 *      reproduces the loader's own key derivation (search-v2 domain keys or
 *      legacy fingerprint triples, per the SEARCH_ROLLOUT_MODE posture), and
 *      only rows whose cache_key matches one of those derived keys qualify.
 *      This closes the stale-payload hole: a legacy-keyed row is never
 *      trusted on its payload's displayDomain alone — the key fingerprint
 *      must actually be the one the page derives for that domain.
 *   6. Country scopes are restricted to what every visitor lookup tries
 *      regardless of geo ("all", "United States"): the loader probes
 *      [visitor-country, all, United States] and cannot know a crawler's
 *      geo at sitemap time. A domain backed only by other-country captures
 *      renders the noindex shell for most crawlers, so it stays out of the
 *      sitemap by design — coverage is traded for the noindex guarantee.
 *   7. The emergency brake PUBLIC_BRAND_PAGES_INDEXABLE="0" (noindex on
 *      every /ads/* page) suppresses dynamic entries entirely, and demo
 *      provider environments (no real cache to render) are skipped too, so
 *      the sitemap can never list a page that serves noindex.
 *   8. This is a bounded cache read only — sitemap generation never triggers
 *      live discovery, Browser Rendering, or any paid operation.
 *
 * The sitemap also appends dynamic /timeline/:domain entries (the Offer
 * Timeline) from `landing_page_snapshot` rows, with its own rules below
 * (SITEMAP_TIMELINE_PATH_LIMIT and indexableTimelineEntriesFromRows):
 *
 *   9. A domain qualifies only when at least one of its first
 *      TIMELINE_SNAPSHOT_LIMIT rows (ordered `captured_at ASC, id ASC`, the
 *      loader's own window) survives the proof gate AND is not an
 *      ad-destination.
 *   10. Domain recovery is lossless-only: the registrable domain of a row's
 *      canonical_url hostname, gated by the same normalizeBrandPageDomain the
 *      route applies to its :domain param — a domain the route would 404 on
 *      (reserved TLDs, single labels, IPs) is never listed.
 *   11. No freshness window: unlike brand pages (7-day rule), the timeline
 *      ledger's only indexability rule is the empty-ledger one, so any
 *      proof-complete capture age qualifies.
 *   12. The PUBLIC_BRAND_PAGES_INDEXABLE brake does NOT suppress timeline
 *      entries — the timeline route never reads that env, so its pages stay
 *      indexable under the brake; mirroring the loader means timeline locs
 *      stay live (the brand /ads/* entries below are the ones it kills).
 *   13. Same zero-cost rule: one bounded D1 read at sitemap-render time, now
 *      capped at SITEMAP_TIMELINE_READ_LIMIT = SITEMAP_TIMELINE_PATH_LIMIT *
 *      TIMELINE_SNAPSHOT_LIMIT rows (issue #1928 — widened from a global
 *      newest-500 to a per-domain ASC first-200 window so the lister mirrors
 *      loadOfferTimeline's own per-domain LIMIT). The read is still bounded
 *      (D1's default 100k row-read limit; the read sits at that boundary by
 *      design), and the per-domain grouping collapses the result to
 *      SITEMAP_TIMELINE_PATH_LIMIT distinct domains. Missing
 *      landing_page_snapshot table on a fresh D1 degrades to the static
 *      sitemap, never a 500.
 *   14. Per-domain qualification reuses the existing proof + ad-destination
 *      gates; the only added work is per-domain grouping and a per-domain
 *      first-200 window selection before the gates run. TIMELINE_SNAPSHOT_LIMIT
 *      itself is unchanged in the loader.
 */

import {
  adHasVerifiedDomainLink,
  deriveBrandPageLookupForCountry,
  isBrandPageAliasDomain,
  normalizeBrandPageDomain,
  BRAND_PAGE_FRESH_FOR_INDEXING_MS,
} from "~/lib/brand-page.server";
import {
  brandCategoryForDomain,
  brandCategoryFromSlug,
  CURATED_BRAND_CATEGORY_SLUGS,
} from "~/lib/brand-categories";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import { queryAll } from "~/lib/data/d1.server";
import type { AppEnv } from "~/lib/env.server";
import {
  snapshotRowHasCompleteProof,
  TIMELINE_SNAPSHOT_LIMIT,
  type LandingPageSnapshotRow,
} from "~/lib/offer-timeline.server";
import { shouldApplySearchV2 } from "~/lib/search-rollout.server";
import { registrableDomainFromHostname } from "~/lib/search-query";
import { CHANGELOG_ENTRY_DATES, renderSitemapXml, ROOT_SITEMAP_STATIC_ENTRIES, SITEMAP_STATIC_ENTRIES, type SitemapEntry } from "~/lib/seo";
import type { AdRecord } from "~/lib/types";

/**
 * Hard bound on dynamic brand-page entries per sitemap render. Keeps the
 * D1 read, the payload parsing, and the sitemap itself bounded (Google's
 * limit is 50k URLs per sitemap). Raised 500 → 5000 for the programmatic
 * /ads/:domain scale-out (issue #966): the seed-list publisher (#1549) grows
 * the fresh indexable set into the thousands, and 5000 stays a deliberate
 * crawl-budget ceiling — one tenth of Google's cap, still one bounded D1
 * read per render, and the sitemap response is cached for an hour.
 */
export const SITEMAP_BRAND_PATH_LIMIT = 5000;

/**
 * Hard bound on dynamic /timeline/:domain entries per sitemap render, next
 * to the brand-page bound above. Same rationale: keeps the D1 read and the
 * sitemap bounded (500 timelines is the same crawl-budget ceiling).
 */
export const SITEMAP_TIMELINE_PATH_LIMIT = 500;

// Sitemap read cost: up to N rows per render (issue #1928 — widened from a
// global newest-500 to a per-domain ASC first-200 window so the lister mirrors
// loadOfferTimeline's own per-domain LIMIT; see rules 9–14 of the module
// docblock + `loadIndexableTimelineEntries`).
export const SITEMAP_TIMELINE_READ_LIMIT =
  SITEMAP_TIMELINE_PATH_LIMIT * TIMELINE_SNAPSHOT_LIMIT;

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
 * Mirror of the brand-page loader's populated-vs-thin indexability gate
 * (issue #1442). A row qualifies for the sitemap when its page would render
 * at least one VERIFIED-linked ad (real landing-page/advertiser-domain
 * evidence to the registrable domain) — the page is populated, not thin. The
 * Ad Aggression Score may still be deferred (window below the 14-day floor,
 * or no first-seen date) without making the page thin; indexability is
 * decoupled from score computability. Only a wall with ZERO verified-linked
 * ads ships as indexable thin content and must stay out, mirroring the
 * loader's `verifiedLinkedAds.length === 0 → noindex` rule so the sitemap
 * and the live page agree on indexability.
 *
 * The ads are read from the cached payload as-is (the cache stores full
 * AdRecord objects); an ad with missing/invalid link evidence degrades to
 * not-verified and does not single-handedly qualify a row — a false positive
 * would list a thin page that actually serves noindex.
 */
export function brandPageRowVerifiedAdCount(row: SitemapCacheRow, domain: string): number {
  const payload = parseSitemapCachePayload(row.payload_json);
  if (!payload) {
    return 0;
  }
  const ads = nonDemoAdsFromPayload(payload);
  return ads.filter((ad) => adHasVerifiedDomainLink(ad as AdRecord, domain)).length;
}

export function brandPageRowHasVerifiedAds(row: SitemapCacheRow, domain: string): boolean {
  return brandPageRowVerifiedAdCount(row, domain) > 0;
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
 * this brand). Kept separate from the D1 read so the filtering rules are
 * unit-testable without a database.
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
    // Issue #1446 criterion 3: an alias page 301-redirects to its canonical
    // brand page, so it is no longer a distinct indexable URL — never list it.
    if (isBrandPageAliasDomain(domain)) {
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
    // Indexability is a content-thinness rule, not a score rule: a populated
    // page (≥1 verified-linked ad) is indexable even when the Ad Aggression
    // Score is deferred, so a row is listed once it has verified link
    // evidence — never list a wall with ZERO verified-linked ads (that page
    // self-noindexes). Mirrors the loader's
    // `verifiedLinkedAds.length === 0 → noindex` rule (issue #1442).
    const verifiedAdCount = brandPageRowVerifiedAdCount(row, domain);
    if (verifiedAdCount === 0) {
      continue;
    }
    seen.add(domain);
    const fetchedDate = row.fetched_at.slice(0, 10);
    const payload = parseSitemapCachePayload(row.payload_json);
    const adCount = payload ? nonDemoAdsFromPayload(payload).length : 0;
    entries.push({
      path: `/ads/${domain}`,
      lastmod: fetchedDate,
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
 * Retired (issue #2962): the per-locale `/<locale>/sitemap.xml` builders
 * (`staticSitemapEntriesForLocale`, `buildLocaleSitemapXml`,
 * `publicLocaleSitemapFile`) shipped with the buyer-surface locale cluster
 * and are gone with it — no locale sitemap is served or listed anywhere.
 */

/**
 * Newest changelog entry date (YYYY-MM-DD), or null when there are no dated
 * entries. The /changelog sitemap `lastmod` is derived from this at render
 * time so it tracks the page's real newest entry instead of a hardcoded
 * value (issue #2297). `CHANGELOG_ENTRY_DATES` is kept in sync with the
 * `<PublicDocBlock title="YYYY-MM-DD">` literals in app/routes/changelog.tsx
 * by tests/changelog-staleness.test.ts.
 */
export function newestChangelogLastmod(
  dates: readonly string[] = CHANGELOG_ENTRY_DATES,
): string | null {
  if (dates.length === 0) {
    return null;
  }
  return dates.reduce((max, date) => (date > max ? date : max), dates[0]);
}

/**
 * Stamp dated static sitemap entries with an honest `lastmod` derived from
 * their content data at render time (issue #2297). /changelog gets the
 * newest changelog entry date. /compare/* and /methodology have no per-page
 * content date field, so they keep no `lastmod` — inventing one would be a
 * false freshness claim Google then distrusts. Other static paths are
 * unchanged.
 */
function staticEntriesWithDatedLastmod(
  entries: readonly SitemapEntry[],
): SitemapEntry[] {
  const changelogLastmod = newestChangelogLastmod();
  if (!changelogLastmod) {
    return [...entries];
  }
  return entries.map((entry) =>
    entry.path === "/changelog"
      ? { ...entry, lastmod: changelogLastmod }
      : entry,
  );
}

/**
 * Dynamic sitemap entries for the curated /brands/:slug category pages
 * (issue #2067). One entry per NON-EMPTY curated category, derived from the
 * same indexable brand-page set the hub and category routes read — a category
 * page is never listed unless it would actually render brands (it 404s when
 * empty, so listing it would point crawlers at a 404). "More brands" (the
 * fallback bucket with no landing page) is never a curated slug and never
 * emitted. Each entry's `lastmod` is the newest brand lastmod in that
 * category (the honest freshness signal — when we last saw real ads for the
 * freshest brand in the set); a category with no dated brand entries ships
 * without a `lastmod` rather than inventing one. Pure, so the rule is
 * unit-testable without a database.
 */
export function brandCategorySitemapEntries(
  brandEntries: readonly SitemapEntry[],
): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  for (const slug of CURATED_BRAND_CATEGORY_SLUGS) {
    const label = brandCategoryFromSlug(slug);
    if (!label) {
      continue;
    }
    let newestLastmod: string | null = null;
    let count = 0;
    for (const entry of brandEntries) {
      if (!entry.path.startsWith("/ads/")) {
        continue;
      }
      const domain = entry.path.slice("/ads/".length);
      if (!domain || domain.includes("/") || domain.includes("?")) {
        continue;
      }
      if (brandCategoryForDomain(domain) !== label) {
        continue;
      }
      count += 1;
      if (entry.lastmod && (newestLastmod === null || entry.lastmod > newestLastmod)) {
        newestLastmod = entry.lastmod;
      }
    }
    // Empty curated category — its page 404s, so never list it.
    if (count === 0) {
      continue;
    }
    entries.push({
      path: `/brands/${slug}`,
      lastmod: newestLastmod ?? undefined,
    });
  }
  return entries;
}

/**
 * Full production sitemap body: static funnel entries first, then the
 * dynamic indexable brand-page entries (with lastmod from their cache
 * fetched_at), then the dynamic curated /brands/:slug category entries
 * (issue #2067), then the dynamic indexable /timeline/:domain entries (with
 * lastmod from their newest snapshot capture). The root feed
 * deliberately EXCLUDES every buyer-surface locale-prefixed path (those live
 * only in their own `/<locale>/sitemap.xml` — see
 * `ROOT_SITEMAP_STATIC_ENTRIES` in app/lib/seo.ts) so no URL is listed twice
 * across the root and locale sitemaps (issue #1561). The /changelog static
 * entry carries a `lastmod` derived from the newest changelog entry date
 * (issue #2297); the other static paths keep no `lastmod`.
 */
export function buildSitemapXml(
  brandEntries: readonly SitemapEntry[],
  timelineEntries: readonly SitemapEntry[] = [],
  categoryEntries: readonly SitemapEntry[] = [],
): string {
  return renderSitemapXml([
    ...staticEntriesWithDatedLastmod(ROOT_SITEMAP_STATIC_ENTRIES),
    ...brandEntries,
    ...categoryEntries,
    ...timelineEntries,
  ]);
}

/**
 * Timeline sitemap entries (the Offer Timeline) — rules 7–11 of the module
 * docblock. Pure reduce lives here; the D1 read is `loadIndexableTimelineEntries`.
 */

/** Subset of landing_page_snapshot columns the sitemap timeline read needs. */
export interface TimelineSitemapRow {
  id: string;
  canonical_url: string;
  captured_at: string;
  artifact_key: string | null;
  metadata_json: string | null;
  /** True when the row is an ad-destination capture (issue #1729). */
  is_ad_destination: number | null;
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
 * Pure core: reduce snapshot rows to deduped, bounded /timeline/:domain
 * sitemap entries that the timeline route would render indexable. Mirrors
 * `loadOfferTimeline`'s own noindex predicate for capture-backed pages
 * (entries.length > 0): a domain with ZERO recorded offer states is never
 * listed (issue #2881 — empty /timeline pages must not ship into the
 * sitemap). The input is assumed to be ordered
 * `captured_at ASC, id ASC` (matching the loader's SQL); for each derived
 * registrable domain the function keeps only the first TIMELINE_SNAPSHOT_LIMIT
 * rows (= the loader's own per-domain window), then applies the proof gate
 * (`snapshotRowHasCompleteProof`) AND the ad-destination gate
 * (`!row.is_ad_destination`). A domain qualifies as capture-backed when at
 * least one row in that window survives both gates — the same set
 * `loadOfferTimeline` would render as a dated ledger. No freshness window — unlike brand pages, the
 * timeline ledger renders indexable regardless of capture age. Each entry's
 * `lastmod` is the newest passing row's captured_at within the window
 * ("newest" = last in the ASC-ordered window). Capped at
 * `SITEMAP_TIMELINE_PATH_LIMIT` distinct domains. Kept separate from the
 * D1 read so the filtering rules are unit-testable without a database.
 */
export function indexableTimelineEntriesFromRows(
  rows: readonly TimelineSitemapRow[],
): SitemapEntry[] {
  // Group input rows by derived registrable domain. Rows whose URL cannot be
  // losslessly mapped to a /timeline/:domain param (timelineDomainFromSnapshotRow
  // returns null — reserved TLDs, non-http(s) URLs, etc.) are dropped here and
  // never enter a bucket, matching rule 10 of the module docblock.
  const byDomain = new Map<string, TimelineSitemapRow[]>();
  for (const row of rows) {
    const domain = timelineDomainFromSnapshotRow(row);
    if (!domain) {
      continue;
    }
    let bucket = byDomain.get(domain);
    if (!bucket) {
      bucket = [];
      byDomain.set(domain, bucket);
    }
    bucket.push(row);
  }

  const entries: SitemapEntry[] = [];
  for (const [domain, bucket] of byDomain) {
    // Loader's per-domain window: only the first TIMELINE_SNAPSHOT_LIMIT
    // rows (the input is ASC, matching the loader's `ORDER BY ... ASC LIMIT
    // TIMELINE_SNAPSHOT_LIMIT` window). Rows past the loader's window are
    // unreachable on /timeline/:domain, so they cannot back a sitemap entry.
    const window = bucket.length > TIMELINE_SNAPSHOT_LIMIT
      ? bucket.slice(0, TIMELINE_SNAPSHOT_LIMIT)
      : bucket;

    // Walk the window in ASC order; the last passing row's captured_at is
    // the newest captured_at within the loader's window (newest in ASC =
    // last within the window).
    let lastmod: string | null = null;
    let passing = false;
    for (const row of window) {
      // The loader's proof gate: a row without both screenshot AND page-text
      // artifacts is filtered out of the ledger, so its domain would render
      // empty (gone/noindex) and must not be listed. Mirrors
      // snapshotRowHasCompleteProof as applied by loadOfferTimeline
      // (issue #1284).
      if (!snapshotRowHasCompleteProof(row)) {
        continue;
      }
      // Brand-page gate (issue #1729): an ad-destination row (the loader
      // excludes it from the ledger) must not qualify its domain either, so
      // the sitemap cannot list a /timeline/:domain whose only qualifying
      // snapshots are ad destinations. Mirrors loadOfferTimeline's filter.
      if (row.is_ad_destination) {
        continue;
      }
      passing = true;
      lastmod = row.captured_at.slice(0, 10);
    }
    if (!passing || lastmod === null) {
      continue;
    }

    entries.push({
      path: `/timeline/${domain}`,
      lastmod,
    });
  }

  // Cap at SITEMAP_TIMELINE_PATH_LIMIT distinct domains. Map iteration is
  // insertion-ordered (ECMAScript 2015+); insertion order is "first
  // input-row-seen for each domain", not captured_at ASC across domains,
  // so the bound is deterministic for a fixed input set but arbitrary
  // across input sets — the first SITEMAP_TIMELINE_PATH_LIMIT qualifying
  // domains in the order their first row surfaces in the input.
  if (entries.length > SITEMAP_TIMELINE_PATH_LIMIT) {
    entries.length = SITEMAP_TIMELINE_PATH_LIMIT;
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
 *
 * The read covers `SITEMAP_TIMELINE_READ_LIMIT` rows (= SITEMAP_TIMELINE_PATH_LIMIT
 * domains * TIMELINE_SNAPSHOT_LIMIT rows each — issue #1928). Each domain's
 * `indexableTimelineEntriesFromRows` then takes its own first-200 ASC slice
 * (= the loader's own per-domain LIMIT window), so the read MUST be ordered
 * `captured_at ASC, id ASC` to mirror the loader's window. The URL-shape
 * filter (`canonical_url LIKE 'https://%' OR canonical_url LIKE 'http://%'`)
 * is a superset of any loader's per-domain URL filter; the JS-side
 * `timelineDomainFromSnapshotRow` + group-by narrows it back to the loader's
 * effective set, so no domain can sneak in that the loader would 410.
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
        SELECT
          id,
          canonical_url,
          captured_at,
          artifact_key,
          metadata_json,
          EXISTS(
            SELECT 1 FROM ad_observation ao
            WHERE ao.landing_page_snapshot_id = landing_page_snapshot.id
              AND ao.ad_id IS NOT NULL
          ) AS is_ad_destination
        FROM landing_page_snapshot
        WHERE canonical_url LIKE 'https://%' OR canonical_url LIKE 'http://%'
        ORDER BY captured_at ASC, id ASC
        LIMIT ?
      `,
      SITEMAP_TIMELINE_READ_LIMIT,
    );
    return indexableTimelineEntriesFromRows(rows);
  } catch (error) {
    if (isMissingTimelineTableError(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * The /timeline/:domain sitemap set: ONLY capture-backed entries — a domain
 * with at least one proof-complete, non-ad-destination snapshot (i.e. at
 * least one recorded offer state). Zero-state "collecting" pages are never
 * listed (issue #2881): listing a domain with 0 recorded offer states ships
 * an empty thin page on an acquisition surface, exactly what BET 5's "no page
 * ships empty" gate forbids. Those pages still render for tracked /ads brands
 * (the route keeps the honest collecting 200) but carry robots noindex and
 * stay out of sitemap.xml and /llms.txt. Still capped at
 * SITEMAP_TIMELINE_PATH_LIMIT for the bounded-read guarantee.
 */
export function timelineSitemapEntries(
  timelineEntries: readonly SitemapEntry[],
): SitemapEntry[] {
  if (timelineEntries.length > SITEMAP_TIMELINE_PATH_LIMIT) {
    return timelineEntries.slice(0, SITEMAP_TIMELINE_PATH_LIMIT);
  }
  return [...timelineEntries];
}

/**
 * Degrade to the static sitemap when a fresh D1 has no snapshot table. */
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
  const categoryEntries = brandCategorySitemapEntries(brandEntries);
  return {
    body: buildSitemapXml(
      brandEntries,
      timelineSitemapEntries(timelineEntries),
      categoryEntries,
    ),
    contentType: "application/xml; charset=utf-8",
    cacheControl: "public, max-age=3600",
  };
}
