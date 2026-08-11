/**
 * Public programmatic brand pages (/ads/:domain) — cache-only data layer.
 *
 * ABSOLUTE CONSTRAINT: everything here renders from the existing discovery
 * cache. A public brand-page request must NEVER trigger live scraping,
 * Browser Rendering, Meta API calls, or any other paid operation, for any
 * input. The only I/O in this module is bounded D1 reads through
 * `readDiscoveryCacheEntryCacheOnly` (max BRAND_PAGE_MAX_CACHE_LOOKUPS rows).
 */

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import { adLongevityDays } from "~/lib/ad-display";
import {
  AGGRESSION_FRESHNESS_DAYS,
  AGGRESSION_PERSISTENCE_DAYS,
  aggressionBandForScore,
  AGGRESSION_FORMULA_VERSION,
  linearShareCurvePoints,
  MIN_AGGRESSION_WINDOW_DAYS,
  testingCurvePoints,
  velocityCurvePoints,
  type AggressionBandId,
  type AggressionScoreComponents,
} from "~/lib/aggression-score";
import {
  applyWebsiteSearchFallback,
  normalizeCompetitorWebsiteInput,
} from "~/lib/competitor-website";
import { ALL_COUNTRIES_VALUE } from "~/lib/countries";
import {
  isDiscoveryCacheRouteCompatible,
  readDiscoveryCacheEntryCacheOnly,
} from "~/lib/discovery-cache.server";
import type { AppEnv } from "~/lib/env.server";
import { fingerprintSavedQuery, normalizeSavedQuery, parseSearchParams } from "~/lib/normalize";
import {
  parseSearchInputFromWebsiteField,
  registrableDomainFromHostname,
} from "~/lib/search-query";
import { shouldApplySearchV2 } from "~/lib/search-rollout.server";
import { buildSearchV2CacheKey, buildSearchV2SavedQuery } from "~/lib/search-v2.server";
import type { AdRecord, SearchResponse } from "~/lib/types";

/** Path params beyond this length are rejected before any parsing. */
const BRAND_PAGE_DOMAIN_MAX_LENGTH = 80;
/** Letters/digits/dots/hyphens only — anything else is a hard 404. */
const BRAND_PAGE_DOMAIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,78}[a-zA-Z0-9])?$/;
/** Hard bound on cache lookups per request (spec: ≤ 4). */
export const BRAND_PAGE_MAX_CACHE_LOOKUPS = 4;
/** Entries older than this render the honest "not checked recently" shell. */
export const BRAND_PAGE_MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Entries older than this still render but always carry noindex. */
export const BRAND_PAGE_FRESH_FOR_INDEXING_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Oldest capture that may still claim "right now"/"live" on a public brand
 * page. Public pages render ONLY from the cache, so a present-tense claim is
 * honest only while the check is inside the current hour (the freshness stamp
 * reads "moments ago" / "about N minutes ago"). Older captures switch to
 * past-tense copy ("was running … at the last check") with the explicit
 * "Last checked N ago" stamp as the only time claim.
 */
export const BRAND_PAGE_LIVE_CLAIM_MAX_AGE_MS = 60 * 60 * 1000;
/** Cap the number of ads rendered on a public page. */
const BRAND_PAGE_MAX_ADS = 24;

export interface BrandPageDomain {
  /** Normalized registrable host, e.g. "nykaa.com" — safe for URLs and copy. */
  domain: string;
  /** Title-cased brand label, e.g. "Nykaa". */
  displayName: string;
}

export interface BrandPageCacheSnapshot {
  ads: AdRecord[];
  /** ISO timestamp of the underlying Ad Library check. */
  fetchedAt: string;
  /** Country the cached search targeted ("all" or a catalog country name). */
  country: string;
  /** Age of the cache entry in ms at read time. */
  ageMs: number;
  /** True when young enough (≤ 7 days) to be indexable. */
  freshForIndexing: boolean;
  /**
   * True only while the capture is young enough (≤ 1 hour) that "right now" /
   * "live" copy is honest. Older captures render past-tense copy.
   */
  freshForLiveClaim: boolean;
}

export interface BrandIntelTeaser {
  totalCount: number;
  activeCount: number;
  longestRunningDays: number | null;
  longestRunningHook: string | null;
  formats: string[];
}

/**
 * Validate and normalize the :domain path param. Returns null (→ 404) for
 * anything that is not a plain public domain: bad characters, over-length
 * input, userinfo/scheme smuggling, or single labels without a TLD.
 */
export function normalizeBrandPageDomain(param: string | undefined): BrandPageDomain | null {
  const raw = (param ?? "").trim().toLowerCase();
  if (!raw || raw.length > BRAND_PAGE_DOMAIN_MAX_LENGTH) {
    return null;
  }
  if (!BRAND_PAGE_DOMAIN_PATTERN.test(raw) || raw.includes("..")) {
    return null;
  }

  const website = normalizeCompetitorWebsiteInput(raw);
  if (!website.host || website.error) {
    return null;
  }
  // The param must BE the domain — reject anything that normalized away
  // (defense in depth; the charset already blocks paths/schemes/userinfo).
  if (website.host !== raw.replace(/^www\./, "")) {
    return null;
  }

  return {
    domain: website.host,
    displayName: website.displayName ?? website.host,
  };
}

/**
 * Read the most likely discovery-cache entries for this brand — visitor
 * country first, then "all", then "United States" — and return the first
 * usable public snapshot. Cache-only: zero provider calls, ≤ 4 D1 reads.
 *
 * Honesty rules: demo-sourced entries are never returned (a public page must
 * not present sample data as a brand's real ads), scheduled-scan entries are
 * skipped (interactive public_search cache only), and entries older than 30
 * days are treated as "not checked recently".
 */
export async function loadBrandPageCacheSnapshot(
  env: AppEnv,
  input: { domain: string; visitorCountry: string; now?: Date },
): Promise<BrandPageCacheSnapshot | null> {
  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo" || !env.DB) {
    // Unconfigured/demo environments have no real public cache to show.
    return null;
  }

  const now = input.now ?? new Date();
  const countries = candidateCountries(input.visitorCountry);

  let lookups = 0;
  for (const country of countries) {
    if (lookups >= BRAND_PAGE_MAX_CACHE_LOOKUPS) {
      break;
    }
    lookups += 1;

    const entry = await readDiscoveryCacheEntryCacheOnly(env, {
      provider,
      ...deriveCacheLookup(env, provider, input.domain, country),
    });
    const snapshot = toUsableSnapshot(entry, now);
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

/** Compact honest intelligence teaser derived from the cached ads only. */
export function buildBrandIntelTeaser(ads: AdRecord[], now: Date = new Date()): BrandIntelTeaser {
  const activeCount = ads.filter((ad) => ad.active).length;
  const formats = [...new Set(ads.map((ad) => ad.format).filter(Boolean))];

  let longestRunningDays: number | null = null;
  let longestRunningHook: string | null = null;
  for (const ad of ads) {
    const days = adLongevityDays(ad, now);
    if (days !== null && (longestRunningDays === null || days > longestRunningDays)) {
      longestRunningDays = days;
      longestRunningHook = ad.hook?.trim() || ad.previewHeadline?.trim() || null;
    }
  }

  return {
    totalCount: ads.length,
    activeCount,
    longestRunningDays,
    longestRunningHook,
    formats,
  };
}

const MS_PER_DAY = 86_400_000;

/**
 * Cache-only "is this creative the brand's own ad?" test. A public brand page
 * may only say "{brand} is running these ads" when the cached creatives are
 * actually the brand's own Meta pages — a domain-mode search also returns ads
 * from OTHER advertisers (resellers, affiliates, sellers) whose landing pages
 * point at the brand's site. This never queries a provider; it reads signals
 * already stored on each cached ad, in strength order:
 *
 *  1. `domainMatch.level` evidence from the search-v2 pipeline:
 *     `verified_advertiser_domain` (the advertiser's own domain matched the
 *     searched domain) or `verified_entity` (advertiser name carries a known
 *     brand identity alias and the landing page matches). Landing-page-only
 *     levels (`exact_hostname`, `registrable_domain`, `verified_alias`) are
 *     deliberately NOT enough — they prove a connection, not ownership.
 *  2. The advertiser page name carries the brand's own registrable domain as
 *     a token (e.g. "Nykaa Beauty — nykaa.com").
 *  3. The advertiser page name carries the brand's label as a whole word
 *     (e.g. "Nykaa", "Nykaa Fashion") — the official-page naming convention.
 *     Known boundary: a seller page named with the brand label ("Nykaa
 *     Outlet") counts as the brand's, matching the ad-card display and the
 *     search product's advertiser-alias convention; advertisers with
 *     unrelated names never count.
 *
 * Anything else (unrelated advertiser pages that merely link to the brand,
 * text-only matches, blank advertiser names) is NOT counted, so the page never
 * claims the brand runs ads it cannot attribute.
 */
export function adIsBrandOwned(ad: AdRecord, brandDomain: string): boolean {
  const matchLevel = ad.domainMatch?.level;
  if (matchLevel === "verified_advertiser_domain" || matchLevel === "verified_entity") {
    return true;
  }

  const advertiser = (ad.advertiser ?? "").trim();
  if (!advertiser) {
    return false;
  }
  const normalized = advertiser.toLowerCase();

  const registrable = registrableDomainFromHostname(brandDomain);
  if (registrable && wordBoundaryMatch(normalized, registrable)) {
    return true;
  }

  // Short labels ("my", "in") are too ambiguous to trust for ownership.
  const label = registrable?.split(".")[0];
  if (label && label.length >= 3 && wordBoundaryMatch(normalized, label)) {
    return true;
  }

  return false;
}

/** How many of the cached creatives are ads the brand itself runs. */
export function countBrandOwnedAds(ads: AdRecord[], brandDomain: string): number {
  return ads.filter((ad) => adIsBrandOwned(ad, brandDomain)).length;
}

/** Whole-word (case-insensitive) containment: "Nykaa" matches "Nykaa Fashion", not "Nykaam". */
function wordBoundaryMatch(haystack: string, needle: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`).test(haystack);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Public-page read of the Ad Aggression Score, computed cache-only from the
 * cached ads' REAL observed fields — never a model, never invented. The
 * observed window is the span from the oldest ad we can still see (its real
 * "started running" date) to now; the four 0-25 components reuse the exact
 * public curve functions in `aggression-score.ts`, so the displayed bars
 * always sum to the displayed score with no hidden weighting.
 *
 * Returns null (→ the UI shows "not enough history yet to score") when the
 * observed window is shorter than MIN_AGGRESSION_WINDOW_DAYS or no ad carries
 * a first-seen date — never a score on thin evidence.
 */
export interface BrandPageAggression {
  score: number;
  components: AggressionScoreComponents;
  bandId: AggressionBandId;
  bandLabel: string;
  bandInterpretation: string;
  formulaVersion: typeof AGGRESSION_FORMULA_VERSION;
  windowDays: number;
  adsPerWeek: number;
  adCount: number;
  activeCount: number;
}

export function computeBrandPageAggressionScore(
  ads: AdRecord[],
  now: Date = new Date(),
): BrandPageAggression | null {
  if (ads.length === 0) {
    return null;
  }

  let earliestFirstSeen = Number.POSITIVE_INFINITY;
  for (const ad of ads) {
    if (!ad.firstSeenAt) continue;
    const parsed = Date.parse(ad.firstSeenAt);
    if (!Number.isNaN(parsed) && parsed < earliestFirstSeen) {
      earliestFirstSeen = parsed;
    }
  }
  if (!Number.isFinite(earliestFirstSeen)) {
    return null;
  }

  const windowDays = Math.floor((now.getTime() - earliestFirstSeen) / MS_PER_DAY);
  if (windowDays < MIN_AGGRESSION_WINDOW_DAYS) {
    return null;
  }

  const adCount = ads.length;
  const adsPerWeek = adCount / (windowDays / 7);

  const testedCount = ads.filter((ad) => (ad.variantCount ?? 0) > 1).length;
  const testedShare = testedCount / adCount;

  const activeAds = ads.filter((ad) => ad.active);
  const freshCutoff = now.getTime() - AGGRESSION_FRESHNESS_DAYS * MS_PER_DAY;
  const freshCount = activeAds.filter((ad) => {
    if (!ad.firstSeenAt) return false;
    const firstSeen = Date.parse(ad.firstSeenAt);
    return !Number.isNaN(firstSeen) && firstSeen >= freshCutoff;
  }).length;
  const freshShare = activeAds.length > 0 ? freshCount / activeAds.length : 0;

  const persistentCount = ads.filter((ad) => {
    const days = adLongevityDays(ad, now);
    return days !== null && days >= AGGRESSION_PERSISTENCE_DAYS;
  }).length;
  const persistentShare = persistentCount / adCount;

  const components: AggressionScoreComponents = {
    velocity: Math.round(velocityCurvePoints(adsPerWeek)),
    testing: Math.round(testingCurvePoints(testedShare)),
    freshness: Math.round(linearShareCurvePoints(freshShare)),
    persistence: Math.round(linearShareCurvePoints(persistentShare)),
  };
  const score =
    components.velocity + components.testing + components.freshness + components.persistence;
  const band = aggressionBandForScore(score);

  return {
    score,
    components,
    bandId: band.id,
    bandLabel: band.label,
    bandInterpretation: band.interpretation,
    formulaVersion: AGGRESSION_FORMULA_VERSION,
    windowDays,
    adsPerWeek: Math.round(adsPerWeek * 10) / 10,
    adCount,
    activeCount: activeAds.length,
  };
}

/** Ads first observed within this window count toward the "what changed" feed. */
export const BRAND_CHANGE_FEED_WINDOW_DAYS = 14;
/** Cap the number of change rows rendered on the public timeline. */
const BRAND_CHANGE_FEED_MAX_ROWS = 5;

export interface BrandChangeEvent {
  /** Stable key for React. */
  id: string;
  /** Short weekday/relative badge, e.g. "Mon" or "Today". */
  dayLabel: string;
  /** True for events first seen today — rendered with the green accent. */
  isToday: boolean;
  /** Uppercase source tag, e.g. "AD LIBRARY" — always a real capture source. */
  source: string;
  /** One-line move: the ad that entered rotation. */
  move: string;
  /** Muted "why it matters" line — a factual template, never a model inference. */
  why: string;
  /** Multi-variant count when > 1, for an honest "testing" read. */
  variantCount: number | null;
}

/**
 * Build an honest "what changed this week" feed from the cached ads alone: an
 * ad whose real first-seen date lands inside the recent window genuinely
 * entered rotation on that date, so each row maps 1:1 to a real ad and a real
 * capture source. We can only assert "new ad" from a single cache snapshot —
 * price/creative diffs need monitoring history a public hit does not have — so
 * every row is a "New" event and nothing is invented. Returns [] when no ad
 * was newly observed in the window (→ the section hides rather than fake it).
 */
export function buildBrandChangeFeed(ads: AdRecord[], now: Date = new Date()): BrandChangeEvent[] {
  const windowCutoff = now.getTime() - BRAND_CHANGE_FEED_WINDOW_DAYS * MS_PER_DAY;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const events: (BrandChangeEvent & { firstSeenMs: number })[] = [];
  for (const ad of ads) {
    if (!ad.firstSeenAt) continue;
    const firstSeenMs = Date.parse(ad.firstSeenAt);
    if (Number.isNaN(firstSeenMs) || firstSeenMs < windowCutoff || firstSeenMs > now.getTime()) {
      continue;
    }

    const isToday = firstSeenMs >= startOfToday.getTime();
    const move = brandChangeMove(ad);
    events.push({
      id: ad.metaAdId,
      dayLabel: isToday ? "Today" : brandChangeDayLabel(firstSeenMs),
      isToday,
      source: brandChangeSourceLabel(ad.source),
      move,
      why: brandChangeWhy(ad),
      variantCount: ad.variantCount && ad.variantCount > 1 ? ad.variantCount : null,
      firstSeenMs,
    });
  }

  return events
    .sort((a, b) => b.firstSeenMs - a.firstSeenMs)
    .slice(0, BRAND_CHANGE_FEED_MAX_ROWS)
    .map(({ firstSeenMs: _firstSeenMs, ...event }) => event);
}

function brandChangeMove(ad: AdRecord): string {
  const headline = ad.previewHeadline?.trim() || ad.hook?.trim() || ad.body?.trim();
  if (headline) {
    return `New ad entered rotation — "${truncate(headline, 90)}"`;
  }
  const format = ad.format && ad.format !== "unknown" ? `${ad.format} ` : "";
  return `New ${format}ad entered rotation`;
}

function brandChangeWhy(ad: AdRecord): string {
  if (ad.variantCount && ad.variantCount > 1) {
    // Advertiser-neutral: the cached creatives may not all be the brand's own
    // ads, so the reason line must not imply the brand ran this one.
    return `Launched with ${ad.variantCount} variants — the advertiser is testing which creative wins.`;
  }
  if (ad.offer?.trim()) {
    return `Carries a fresh offer — a demand push worth watching.`;
  }
  return `A new creative in rotation — the kind of move you'd otherwise miss.`;
}

const BRAND_CHANGE_SOURCE_LABELS: Record<string, string> = {
  meta_library_browser: "AD LIBRARY",
  meta_api: "AD LIBRARY",
  demo: "AD LIBRARY",
};

function brandChangeSourceLabel(source: string): string {
  return BRAND_CHANGE_SOURCE_LABELS[source] ?? "AD LIBRARY";
}

const WEEKDAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function brandChangeDayLabel(ms: number): string {
  const day = new Date(ms).getUTCDay();
  return WEEKDAY_LABELS[day] ?? "—";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Coarse honest relative label for the freshness line ("about 3 hours ago"). */
export function formatBrandPageCheckedAgo(fetchedAt: string, now: Date = new Date()): string {
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) {
    return "a while ago";
  }

  const elapsedMs = Math.max(0, now.getTime() - fetchedMs);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 2) return "moments ago";
  if (minutes < 60) return `about ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 2) return "about an hour ago";
  if (hours < 24) return `about ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "about a day ago";
  return `about ${days} days ago`;
}

/**
 * Honest Ad Library country label for public page copy, derived from the
 * snapshot's `country` ("India", "United States", … or "all"). The Meta Ad
 * Library is country-scoped — a page that renders cached ads must name the
 * country whose library they came from instead of letting the visitor-geo
 * defaulted lookup speak silently. "all" (the all-countries view) is spelled
 * out as "all countries" so the copy never implies a single market. Returns
 * null when there is no cached snapshot.
 */
export function brandPageAdLibraryCountryLabel(
  country: string | null | undefined,
): string | null {
  const trimmed = country?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase() === ALL_COUNTRIES_VALUE ? "all countries" : trimmed;
}

function candidateCountries(visitorCountry: string): string[] {
  const candidates = [
    visitorCountry?.trim() || ALL_COUNTRIES_VALUE,
    ALL_COUNTRIES_VALUE,
    "United States",
  ];
  return [...new Set(candidates)].slice(0, BRAND_PAGE_MAX_CACHE_LOOKUPS);
}

/**
 * Reproduce the exact cache key the /search execution path would have written
 * for this domain + country (see `hasWarmSearchCacheEntry`): the search-v2
 * domain key when the v2 rollout applies, else the legacy fingerprint triple.
 * Shadow mode serves customers from the legacy key, so it maps to legacy here.
 */
function deriveCacheLookup(
  env: AppEnv,
  provider: string,
  domain: string,
  country: string,
): { fingerprint: string; country: string; cacheKeyOverride: string | null } {
  const website = normalizeCompetitorWebsiteInput(domain);
  const parsedInput = parseSearchParams(new URLSearchParams(), { country });
  const parsed = applyWebsiteSearchFallback(parsedInput, website);
  const queryIntent = shouldApplySearchV2(env) ? parseSearchInputFromWebsiteField(domain) : null;
  const useDomainV2 = Boolean(
    queryIntent && queryIntent.intent === "domain" && queryIntent.registrableDomain,
  );

  if (useDomainV2 && queryIntent) {
    const v2Query = buildSearchV2SavedQuery(queryIntent, "exact", parsed.filters);
    return {
      fingerprint: parsed.fingerprint,
      country: v2Query.filters.country || ALL_COUNTRIES_VALUE,
      cacheKeyOverride: buildSearchV2CacheKey({
        provider,
        intent: queryIntent,
        scope: "exact",
        country: v2Query.filters.country || ALL_COUNTRIES_VALUE,
        cursor: null,
      }),
    };
  }

  // Recompute the fingerprint from the exact NormalizedSavedQuery shape the
  // resolver caches under (searchAdsViaSourceResolver fingerprints the
  // normalized query, not the parsed route input) so the two never drift.
  const legacyQuery = normalizeSavedQuery(parsed.mode, parsed.filters);
  return {
    fingerprint: fingerprintSavedQuery(legacyQuery),
    country: legacyQuery.filters.country || ALL_COUNTRIES_VALUE,
    cacheKeyOverride: null,
  };
}

type CacheEntry = Awaited<ReturnType<typeof readDiscoveryCacheEntryCacheOnly>>;

/**
 * Structural slice of a discovery-cache entry the indexable-state checks
 * below need. Both the full loader entries and the raw sitemap query rows
 * satisfy it.
 */
interface BrandPageCacheEntryProbe {
  routeContext: string | null | undefined;
  payload: {
    source?: string;
    provider?: string;
    ads?: unknown;
  };
  fetchedAt: string;
}

/** The cache's real (non-demo) creatives, or null when none exist. */
function brandPageAdsFromEntry(entry: BrandPageCacheEntryProbe): AdRecord[] | null {
  const ads = Array.isArray(entry.payload.ads)
    ? (entry.payload.ads as AdRecord[]).filter((ad) => ad && ad.source !== "demo")
    : [];
  return ads.length > 0 ? ads : null;
}

function cacheEntryAgeMs(entry: BrandPageCacheEntryProbe, now: Date): number | null {
  const fetchedMs = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetchedMs)) {
    return null;
  }
  return now.getTime() - fetchedMs;
}

/**
 * Shared row-level checks for "this cache entry would render a REAL cached
 * snapshot on the public /ads/:domain page": interactive public_search route
 * context, non-demo source, at least one real ad, and fetched within the
 * 30-day usable window. Used by both the page loader (`toUsableSnapshot`)
 * and the dynamic sitemap (`loadIndexableBrandPageDomains`) so the sitemap
 * can never point at a page that renders the honest shell.
 */
function isBrandPageCacheEntryUsable(entry: BrandPageCacheEntryProbe, now: Date): boolean {
  // Interactive public_search cache only — scheduled scan/warmup entries are
  // shallow and must not back a public page.
  if (!isDiscoveryCacheRouteCompatible("public_search", entry.routeContext)) {
    return false;
  }
  // Never present demo/sample data as a brand's real ads on a public page.
  if (entry.payload.source === "demo" || entry.payload.provider === "demo") {
    return false;
  }
  if (!brandPageAdsFromEntry(entry)) {
    return false;
  }
  const ageMs = cacheEntryAgeMs(entry, now);
  return ageMs !== null && ageMs >= 0 && ageMs <= BRAND_PAGE_MAX_CACHE_AGE_MS;
}

/**
 * The sitemap's exact bar: usable (see above) AND young enough (≤ 7 days) for
 * the page to render WITHOUT the always-noindex stale state. A domain whose
 * every qualifying row fails this is never sitemapped.
 */
function isBrandPageCacheEntryIndexable(entry: BrandPageCacheEntryProbe, now: Date): boolean {
  if (!isBrandPageCacheEntryUsable(entry, now)) {
    return false;
  }
  const ageMs = cacheEntryAgeMs(entry, now);
  return ageMs !== null && ageMs <= BRAND_PAGE_FRESH_FOR_INDEXING_MS;
}

function toUsableSnapshot(entry: CacheEntry, now: Date): BrandPageCacheSnapshot | null {
  if (!entry) {
    return null;
  }
  if (!isBrandPageCacheEntryUsable(entry, now)) {
    return null;
  }
  const ads = brandPageAdsFromEntry(entry) ?? [];
  const ageMs = cacheEntryAgeMs(entry, now);
  if (ageMs === null) {
    return null;
  }

  return {
    ads: ads.slice(0, BRAND_PAGE_MAX_ADS),
    fetchedAt: entry.fetchedAt,
    country: entry.country,
    ageMs,
    freshForIndexing: ageMs <= BRAND_PAGE_FRESH_FOR_INDEXING_MS,
    freshForLiveClaim: ageMs <= BRAND_PAGE_LIVE_CLAIM_MAX_AGE_MS,
  };
}

/** Cache-key prefix of the search-v2 domain pipeline (see search-v2.server.ts). */
const SEARCH_V2_DOMAIN_KEY_PREFIX = "search-v2:domain:";
/**
 * Upper bound on the sitemap's cache read (rows), well under the 50k-entry
 * sitemap limit while keeping the render bounded.
 */
export const BRAND_SITEMAP_MAX_ROWS = 10_000;

/**
 * Domains whose /ads/:domain page would render in the indexable state right
 * now — the dynamic half of the sitemap (see the strategy note above
 * SITEMAP_PATHS in app/lib/seo.ts).
 *
 * A domain qualifies when the shared discovery cache holds a row that BOTH:
 *   1. is exactly the row the /ads loader would read for that domain
 *      (search-v2 domain cache key, exact scope, page-1 cursor, written by
 *      the provider the loader resolves to — customer-scoped rows are never
 *      read by the public page and are excluded), AND
 *   2. passes `isBrandPageCacheEntryIndexable` (public_search route context,
 *      non-demo source, real ads present, fetched within the 7-day indexing
 *      window).
 * Only then can the page genuinely serve 200 without robots noindex to a
 * crawler. This is a single bounded cache READ at sitemap-render time — it
 * never triggers live discovery, and any DB hiccup degrades to the static
 * sitemap rather than failing the request.
 */
export async function loadIndexableBrandPageDomains(
  env: AppEnv,
  options: { now?: Date; maxRows?: number } = {},
): Promise<string[]> {
  const provider = resolveCommercialDiscoveryProvider(env);
  if (provider === "demo" || !env.DB) {
    // No commercial discovery configured (or no D1): /ads pages render the
    // honest shell, so there are no indexable brand pages to publish.
    return [];
  }

  const now = options.now ?? new Date();
  const cutoffIso = new Date(now.getTime() - BRAND_PAGE_FRESH_FOR_INDEXING_MS).toISOString();
  const maxRows = Math.min(
    Math.max(1, Math.floor(options.maxRows ?? BRAND_SITEMAP_MAX_ROWS)),
    BRAND_SITEMAP_MAX_ROWS,
  );

  let rows: Array<{ cache_key: string; payload_json: string; fetched_at: string }> = [];
  try {
    const result = await env.DB.prepare(
      `SELECT cache_key, payload_json, fetched_at
         FROM discovery_cache_entry
        WHERE route_context = 'public_search'
          AND provider != 'demo'
          AND fetched_at >= ?
        ORDER BY fetched_at DESC
        LIMIT ?`,
    )
      .bind(cutoffIso, maxRows)
      .all<{ cache_key: string; payload_json: string; fetched_at: string }>();
    rows = result.results ?? [];
  } catch (error) {
    // Same honesty rule as the page loader: a cache-read hiccup must degrade
    // to the static sitemap, never fail the request.
    console.warn("Brand sitemap cache read failed; publishing the static sitemap.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }

  const domains = new Set<string>();
  for (const row of rows) {
    const domain = indexableDomainFromCacheRow(row, provider, now);
    if (domain) {
      domains.add(domain);
    }
  }

  return [...domains].sort();
}

/**
 * Map one cache row to the /ads/:domain param it would render, or null. The
 * cached payload is raw (the v2 post-filter runs after the cache write), so
 * the domain can only come from the cache-key prefix — never from payload
 * fields. The page loader reads only exact-scope page-1 rows written by the
 * provider it resolves to, so any other shape is excluded even when its
 * payload looks indexable.
 */
function indexableDomainFromCacheRow(
  row: { cache_key: string; payload_json: string; fetched_at: string },
  provider: string,
  now: Date,
): string | null {
  const domain = brandPageDomainFromCacheKey(row.cache_key, provider);
  if (!domain) {
    return null;
  }

  const payload = parseSitemapCachePayload(row.payload_json);
  if (!payload) {
    return null;
  }

  if (
    !isBrandPageCacheEntryIndexable(
      { routeContext: "public_search", payload, fetchedAt: row.fetched_at },
      now,
    )
  ) {
    return null;
  }

  return domain;
}

/**
 * Extract the registrable domain from a `search-v2:domain:{domain}:{scope}:
 * {provider}:{country}:{cursor}` cache key and validate it as an /ads/:domain
 * path param. Exactly 7 segments: customer-scoped keys append
 * `:customer_meta:{hash}` (the public page never reads those) and are
 * excluded; domains cannot contain ":".
 */
function brandPageDomainFromCacheKey(cacheKey: string, provider: string): string | null {
  if (!cacheKey.startsWith(SEARCH_V2_DOMAIN_KEY_PREFIX)) {
    return null;
  }
  const segments = cacheKey.split(":");
  if (segments.length !== 7 || segments[1] !== "domain") {
    return null;
  }
  const [, , domain, scope, keyProvider, , cursor] = segments;
  if (scope !== "exact" || keyProvider !== provider || cursor !== "page-1") {
    return null;
  }
  return normalizeBrandPageDomain(domain)?.domain ?? null;
}

/**
 * Lightweight payload parse for sitemap rows: enough to run the indexable
 * checks (source/provider/ads). Mirrors the resolver's raw cache payloads.
 */
function parseSitemapCachePayload(value: string): Pick<SearchResponse, "source" | "provider" | "ads"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Partial<SearchResponse>;
  if (!Array.isArray(candidate.ads) || typeof candidate.source !== "string") {
    return null;
  }
  return candidate as Pick<SearchResponse, "source" | "provider" | "ads">;
}
