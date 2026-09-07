import {
  buildDiscoveryCacheKey,
  readDiscoveryCacheEntryCacheOnly,
} from "~/lib/discovery-cache.server";
import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import { deriveHook, deriveOffer } from "~/lib/analysis.server";
import { listWatchlists } from "~/lib/data.server";
import {
  fetchWithTimeout,
  releaseFetchTimeout,
} from "~/lib/fetch-timeout.server";
import { extractLandingPageSignals } from "~/lib/landing-page-signals.server";
import {
  normalizePublicHttpUrl,
  resolvePublicHttpUrl,
} from "~/lib/public-url.server";
import {
  parseSearchInputFromWebsiteField,
  registrableDomainFromHostname,
} from "~/lib/search-query";
import { registrableDomainFromLandingPage } from "~/lib/competitor-website";
import { buildSearchV2CacheKey } from "~/lib/search-v2.server";
import type { AppEnv } from "~/lib/env.server";
import type { AdRecord } from "~/lib/types";

/**
 * Auto competitor seed — Phase 1 of the auto-competitor-watch epic
 * (Nishfleet/0509#1366). A PURE library function: no route, no UI, no
 * scheduled task. Given a customer's own domain + country it surfaces
 * candidate competitors they are not yet watching, ranked by keyword +
 * country overlap, without the customer adding anything.
 *
 * Honesty contract (eval 3.4): every candidate is a real advertiser returned
 * by a real (cached) Meta Ad Library probe. A candidate never carries a
 * "confirmed" status — the type is "candidate" with overlapScore + provenance
 * only. When the customer's own domain has no cached ads, the function
 * returns zero candidates rather than fabricating any.
 *
 * Quota contract: every D1-bound read goes through the existing discovery
 * cache (`buildDiscoveryCacheKey` / `buildSearchV2CacheKey`) via
 * `readDiscoveryCacheEntryCacheOnly`, which NEVER falls through to a live
 * provider — no Browser Rendering, no Meta API, no demo fallback. Repeat
 * probes are pure cache hits, so Browser Rendering quota is never burned here.
 */

export interface AutoCompetitorCandidate {
  /** Advertiser display name as returned by the discovery probe. */
  advertiser: string;
  /** Numeric Meta Page id when the probe carried one; null otherwise. */
  advertiserPageId: string | null;
  /** Registrable domain inferred from the candidate's landing page URL. */
  registrableDomain: string | null;
  /** Keyword + country overlap with the customer's own ads (numeric). */
  overlapScore: number;
  /**
   * Provenance string naming the keyword/country probe(s) that surfaced this
   * candidate. States the Meta Ad Library keyword-search ceiling: candidates
   * are only advertisers with active ads on the searched terms.
   */
  provenance: string;
  /** Countries the candidate's ads ran in, across the matching probes. */
  countries: string[];
  /** Distinct probe keywords that surfaced this candidate. */
  matchedKeywords: string[];
}

export interface AutoCompetitorSeedOptions {
  /** The customer's own registrable domain (e.g. "allbirds.com"). */
  domain: string;
  /** Country scope: "all" or a specific country label. */
  country: string;
  /** Customer user id — used to read their existing watchlists for dedup. */
  userId: string;
  /**
   * Optional cap on the number of keyword probes (defaults to 8). The
   * keyword-expansion strategy is advisory (issue AI-advisory note); the
   * deterministic test only pins dedup, provenance, no-fabrication, and
   * cache-routing.
   */
  maxKeywordProbes?: number;
  /**
   * Phase 5 of the auto-competitor-watch epic (#1373): when the customer's
   * own domain has NO cached Meta ads, fall back to crawling their landing
   * page and seeding the keyword search from the extracted value-prop signals
   * (CTA / offer text). Defaults to true. A pure-library caller that must
   * never touch the network (unit test, quota-sensitive path) sets this to
   * false to keep the seed a pure cache read.
   */
  enableLandingPageFallback?: boolean;
}

interface ProbeHit {
  keyword: string;
  country: string;
  ads: AdRecord[];
}

// ==== Landing-page fallback (auto-competitor-watch Phase 5, #1373) ====

/**
 * SSRF-hardened, bounded single-page fetch for the landing-page fallback. The
 * crawl reuses the public-URL helpers (`normalizePublicHttpUrl` +
 * `resolvePublicHttpUrl`) and the fetch-timeout wrapper exactly per
 * competitor-site-monitor's `safeFetchDocument` convention: the URL must be a
 * public http(s) URL, DNS is resolved and every resolved address must be
 * public (resolve-then-connect), every redirect hop is re-validated, and the
 * hop count / body size / time are capped. This is a SINGLE page — not an
 * unbounded crawl (that is epic (b) territory).
 */
const LANDING_PAGE_FETCH_TIMEOUT_MS = 5_000;
const LANDING_PAGE_MAX_BYTES = 512 * 1024;
const LANDING_PAGE_MAX_REDIRECT_HOPS = 3;

/**
 * When the customer pinned no country and their own domain has no ads, the
 * landing-page fallback needs SOME country scope to build a probe cache key.
 * A fixed common market is the advisory default; it is not pinned by the
 * deterministic test (which passes an explicit country).
 */
const LANDING_PAGE_DEFAULT_PROBE_COUNTRIES = ["United States"];

/**
 * Generic CTA chrome / offer boilerplate that adds no targeting value as a
 * Meta keyword-search term. Filtering these keeps the fallback seeding real
 * value-prop nouns ("demo", "trial", "quote") instead of every-page labels
 * ("shop now", "sign up", "get started"). Exact set membership is advisory
 * (issue AI-advisory note); the deterministic test pins only
 * no-fabrication / precedence / provenance, and derives its probes from this
 * same exported extractor.
 */
const LANDING_PAGE_NOISE_WORDS = new Set([
  // generic CTA verbs with no targeting value
  "get", "now", "today", "start", "shop", "learn", "more", "read", "free",
  "sign", "up", "view", "see", "browse", "explore", "contact", "call",
  "order", "claim", "try", "buy", "add", "use", "open", "close",
  "download", "register", "login", "log", "subscribe", "apply", "join",
  "create", "schedule", "request", "book", "save", "only", "just",
  "starting", "starts", "per", "sale", "offer", "click", "tap", "visit",
  "go", "all", "price", "prices", "each", "month", "mo", "year", "annual",
  "renew", "total", "checkout", "select", "choose", "confirm",
  // structural
  "and", "the", "a", "an", "for", "with", "your", "you", "our", "to",
  "in", "on", "of", "at", "this", "that", "so", "we", "me", "us", "is",
]);

/**
 * Extract the probe keywords that seed the landing-page fallback's keyword
 * search. Uses the EXISTING landing-page-signals extractor (reused, never
 * forked): CTA and price/offer signals become candidate seed strings, then
 * each is expanded into a full phrase plus meaningful single-word terms
 * (length >= 4, not CTA chrome, not a number/price token), deduped and capped
 * at `maxProbes`.
 *
 * No usable signal (a blank / shell page with no CTA and no offer text) yields
 * an empty array — the fallback then returns zero candidates rather than
 * fabricating any (honesty eval 3.4).
 */
export function extractLandingPageProbeKeywords(
  html: string,
  maxProbes: number,
): string[] {
  const signals = extractLandingPageSignals(html, { documentMode: "raw" });
  const seeds: string[] = [];
  if (signals.ctaText) {
    seeds.push(signals.ctaText);
  }
  if (signals.priceText) {
    seeds.push(signals.priceText);
  }

  const bound = Math.max(1, maxProbes);
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const term = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!term || seen.has(term)) {
      return;
    }
    seen.add(term);
    out.push(term);
  };

  for (const seed of seeds) {
    push(seed);
    for (const word of seed.split(/\s+/)) {
      if (usableLandingPageProbeWord(word)) {
        push(word);
      }
    }
    if (out.length >= bound) {
      break;
    }
  }

  return out.slice(0, bound);
}

function usableLandingPageProbeWord(word: string): boolean {
  const lower = word.toLowerCase();
  if (lower.length < 4) {
    return false;
  }
  // Drop price tokens and anything carrying a number or currency symbol — a
  // bare price ("$19.99", "20% off") is not a searchable keyword.
  if (/[0-9$€£₹%]/.test(lower)) {
    return false;
  }
  return !LANDING_PAGE_NOISE_WORDS.has(lower);
}

/**
 * Fetch one public (http/https) landing page with SSRF hardening on every hop
 * and a hard fetch timeout + body cap. Returns the raw HTML, or null when the
 * URL is not public, DNS does not resolve to public addresses, any redirect
 * is non-public, the hop/body/time bound is exceeded, or the fetch fails. The
 * caller treats null as "no usable landing page" and returns zero candidates.
 */
async function fetchCustomerLandingPageHtml(url: string): Promise<string | null> {
  const initial = normalizePublicHttpUrl(url);
  if (!initial) {
    return null;
  }
  const initialResolved = await resolvePublicHttpUrl(initial.toString());
  if (!initialResolved) {
    return null;
  }

  let current = initialResolved;
  for (let hop = 0; hop <= LANDING_PAGE_MAX_REDIRECT_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        current.toString(),
        {
          redirect: "manual",
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; FiveToNine-AutoCompetitorSeed/1.0; +https://fivetonine.app/bot)",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        },
        { timeoutMs: LANDING_PAGE_FETCH_TIMEOUT_MS },
      );
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      releaseFetchTimeout(response);
      if (!location) {
        return null;
      }
      const next = normalizePublicHttpUrl(new URL(location, current).toString());
      if (!next) {
        return null;
      }
      const nextResolved = await resolvePublicHttpUrl(next.toString());
      if (!nextResolved) {
        return null;
      }
      current = nextResolved;
      continue;
    }

    if (!response.ok) {
      releaseFetchTimeout(response);
      return null;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      releaseFetchTimeout(response);
      return null;
    }
    let body = "";
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          // Track real decoded byte count (not UTF-16 code units) so the cap
          // is honest for multibyte HTML. The chunk is raw bytes; the decoded
          // string's .length is UTF-16 units and can under-report.
          bytes += value.byteLength;
          if (bytes > LANDING_PAGE_MAX_BYTES) {
            return null;
          }
          body += new TextDecoder().decode(value);
        }
      }
    } catch {
      // A mid-body abort/timeout or transport error must behave like "no
      // usable landing page" (return null → zero candidates), not a thrown
      // rejection — the honest-empty path must never become an error.
      return null;
    } finally {
      reader.releaseLock();
      releaseFetchTimeout(response);
    }
    return body;
  }

  return null;
}

/**
 * Cache key for the customer's OWN domain lookup (search-v2 domain key,
 * exact scope, page 1). The test seeds this exact key.
 */
export function buildOwnDomainCacheKey(input: {
  provider: string;
  domain: string;
  country: string;
}): string | null {
  const intent = parseSearchInputFromWebsiteField(input.domain);
  if (intent.intent !== "domain" || !intent.registrableDomain) {
    return null;
  }
  return buildSearchV2CacheKey({
    provider: input.provider,
    intent,
    scope: "exact",
    country: input.country,
  });
}

/**
 * Cache key for a keyword probe (keyword-mode discovery cache key). The test
 * seeds this exact key for each probe it wants the seed function to see.
 */
export function buildKeywordProbeCacheKey(input: {
  provider: string;
  keyword: string;
  country: string;
}): string {
  return buildDiscoveryCacheKey({
    provider: input.provider,
    fingerprint: `text:${input.keyword}`,
    country: input.country,
    cursor: null,
  });
}

/**
 * Extract probe keywords from a customer's own ads: the derived hook and any
 * explicit offer phrase, plus the single-word terms of multi-word hooks so a
 * broad term like "wool runners" also probes "wool" and "runners". Deduped
 * and capped at `maxKeywordProbes`.
 */
export function extractProbeKeywords(
  ads: ReadonlyArray<AdRecord>,
  maxProbes: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (raw: string) => {
    const term = raw.trim().toLowerCase();
    if (!term || seen.has(term)) {
      return;
    }
    seen.add(term);
    out.push(term);
  };

  for (const ad of ads) {
    const hook = deriveHook(ad.body, ad.previewHeadline);
    if (hook) {
      push(hook);
      for (const word of hook.split(/\s+/)) {
        if (word.length >= 4) {
          push(word);
        }
      }
    }
    const offer = deriveOffer(ad.body, ad.cta);
    if (offer) {
      push(offer);
    }
    if (out.length >= maxProbes) {
      break;
    }
  }

  return out.slice(0, maxProbes);
}

/**
 * Resolve the registrable domain from a URL string (offline — no fetch). This
 * is the load-bearing core of `resolveWebsiteIdentity` for dedup: both the
 * candidate's landing page and the watchlist's target id reduce to a
 * registrable domain via `registrableDomainFromHostname`, so two URLs that
 * resolve to the same registrable domain are the same site for dedup purposes
 * (e.g. mamaearth.com and mamaearth.in share a brand). No live fetch keeps
 * the seed function deterministic and quota-free.
 */
export function resolveRegistrableDomainFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return registrableDomainFromHostname(parsed.hostname);
  } catch {
    return null;
  }
}

interface AggregatedCandidate {
  advertiser: string;
  advertiserPageId: string | null;
  registrableDomain: string | null;
  countries: Set<string>;
  matchedKeywords: Set<string>;
  provenanceParts: string[];
}

type SeedSource = "ads" | "landing_page";

interface SeedProbeRun {
  provider: string;
  ownRegistrableDomain: string;
  keywords: string[];
  probeCountries: string[];
  userId: string;
  seedSource: SeedSource;
}

/**
 * Shared keyword-expansion pipeline for both seed sources. Runs the extracted
 * keywords through the discovery cache (cache-only — never a live provider,
 * never a quota burn), aggregates advertisers, dedupes the customer's own
 * brand and existing watchlists via website-identity, and returns ranked
 * candidates. The provenance string names the seed source (Meta ads vs
 * landing page) so a consumer can tell where each candidate's keyword seed
 * came from. Note: the caller has already done any live landing-page crawl
 * for the no-ads path BEFORE this function runs; this function itself is
 * still cache-only.
 */
async function runSeedProbes(
  env: AppEnv,
  run: SeedProbeRun,
): Promise<AutoCompetitorCandidate[]> {
  const hits: ProbeHit[] = [];
  for (const keyword of run.keywords) {
    for (const country of run.probeCountries) {
      const probeKey = buildKeywordProbeCacheKey({
        provider: run.provider,
        keyword,
        country,
      });
      const entry = await readDiscoveryCacheEntryCacheOnly(env, {
        provider: run.provider,
        fingerprint: `text:${keyword}`,
        country,
        cacheKeyOverride: probeKey,
      });
      const ads = entry?.payload?.ads ?? [];
      if (ads.length > 0) {
        hits.push({ keyword, country, ads });
      }
    }
  }

  if (hits.length === 0) {
    return [];
  }

  const aggregated = new Map<string, AggregatedCandidate>();
  for (const hit of hits) {
    for (const ad of hit.ads) {
      const candidateDomain = registrableDomainFromLandingPage(ad.landingPageUrl);
      if (candidateDomain && candidateDomain === run.ownRegistrableDomain) {
        continue; // the customer's own brand — not a competitor
      }
      const key =
        (ad.advertiserPageId && String(ad.advertiserPageId).trim()) ||
        ad.advertiser.trim().toLowerCase() ||
        candidateDomain ||
        ad.metaAdId;
      const existing = aggregated.get(key);
      if (existing) {
        existing.countries.add(hit.country);
        existing.matchedKeywords.add(hit.keyword);
        existing.provenanceParts.push(
          `keyword:"${hit.keyword}" country:"${hit.country}"`,
        );
        if (!existing.advertiserPageId && ad.advertiserPageId) {
          existing.advertiserPageId = String(ad.advertiserPageId);
        }
        if (!existing.registrableDomain && candidateDomain) {
          existing.registrableDomain = candidateDomain;
        }
      } else {
        aggregated.set(key, {
          advertiser: ad.advertiser,
          advertiserPageId: ad.advertiserPageId ? String(ad.advertiserPageId) : null,
          registrableDomain: candidateDomain,
          countries: new Set([hit.country]),
          matchedKeywords: new Set([hit.keyword]),
          provenanceParts: [`keyword:"${hit.keyword}" country:"${hit.country}"`],
        });
      }
    }
  }

  if (aggregated.size === 0) {
    return [];
  }

  const watched = await listWatchlists(env, run.userId);
  const watchedDomains = new Set<string>();
  for (const wl of watched) {
    if (wl.targetType !== "advertiser") {
      continue;
    }
    const domain = resolveRegistrableDomainFromUrl(wl.targetId);
    if (domain) {
      watchedDomains.add(domain);
    }
  }

  const candidates: AutoCompetitorCandidate[] = [];
  for (const agg of aggregated.values()) {
    if (agg.registrableDomain && watchedDomains.has(agg.registrableDomain)) {
      continue; // already watched — dedup via website-identity holds
    }
    const matchedKeywords = [...agg.matchedKeywords];
    const countries = [...agg.countries];
    const overlapScore = matchedKeywords.length + countries.length;
    const seedPrefix =
      run.seedSource === "landing_page"
        ? "landing_page_seed (own domain has no active Meta ads):"
        : "meta_ad_library_keyword_probe:";
    const provenance =
      `${seedPrefix} ${agg.provenanceParts.join("; ")}. ` +
      `Candidates are only advertisers with active ads on the searched terms.`;
    candidates.push({
      advertiser: agg.advertiser,
      advertiserPageId: agg.advertiserPageId,
      registrableDomain: agg.registrableDomain,
      overlapScore,
      provenance,
      countries,
      matchedKeywords,
    });
  }

  candidates.sort((a, b) => {
    if (b.overlapScore !== a.overlapScore) {
      return b.overlapScore - a.overlapScore;
    }
    return a.advertiser.localeCompare(b.advertiser);
  });

  return candidates;
}

/**
 * The library function. Reads cached discovery entries and the customer's
 * existing watchlists — never a live provider for the PROBE reads (cache-only,
 * no quota burn). Returns ranked candidate competitors not already watched,
 * each with an overlapScore and a provenance string.
 *
 * Phase 5 (#1373): the ADS path is a pure cache read. When the customer's own
 * domain has no cached ads (and the landing-page fallback is enabled), the
 * seed additionally performs ONE live, bounded, SSRF-hardened landing-page
 * crawl (single page, fetch-timeout) and seeds the keyword search from the
 * extracted value-prop signals — so a no-ads customer still gets candidates
 * sourced from real landing-page keywords. When the fallback is disabled or
 * the landing page yields no usable keywords, it returns zero candidates
 * rather than fabricating any (honesty eval 3.4). The crawl is bounded to a
 * single page; it is not an unbounded crawl.
 */
export async function seedAutoCompetitors(
  env: AppEnv,
  options: AutoCompetitorSeedOptions,
): Promise<AutoCompetitorCandidate[]> {
  if (!env.DB) {
    return [];
  }

  const provider = resolveCommercialDiscoveryProvider(env);
  const intent = parseSearchInputFromWebsiteField(options.domain);
  if (intent.intent !== "domain" || !intent.registrableDomain) {
    return [];
  }
  const ownRegistrableDomain = intent.registrableDomain;

  const maxKeywordProbes = Math.max(1, options.maxKeywordProbes ?? 8);
  const enableLandingPageFallback = options.enableLandingPageFallback !== false;

  const ownCacheKey = buildOwnDomainCacheKey({
    provider,
    domain: options.domain,
    country: options.country,
  });
  if (!ownCacheKey) {
    return [];
  }
  const ownEntry = await readDiscoveryCacheEntryCacheOnly(env, {
    provider,
    fingerprint: `domain:${ownRegistrableDomain}`,
    country: options.country,
    cacheKeyOverride: ownCacheKey,
  });
  const ownAds = ownEntry?.payload?.ads ?? [];

  // The customer has cached Meta ads: the ads path takes precedence and the
  // landing-page fallback is NOT used (issue acceptance: "given a domain that
  // DOES have ads, the landing-page fallback is NOT used").
  if (ownAds.length > 0) {
    const keywords = extractProbeKeywords(ownAds, maxKeywordProbes);
    const ownCountries = new Set<string>();
    for (const ad of ownAds) {
      for (const country of ad.countries ?? []) {
        const trimmed = country.trim();
        if (trimmed) {
          ownCountries.add(trimmed);
        }
      }
    }
    const probeCountries =
      options.country.trim().toLowerCase() === "all"
        ? [...ownCountries]
        : [options.country];
    if (probeCountries.length === 0) {
      probeCountries.push(options.country);
    }
    return runSeedProbes(env, {
      provider,
      ownRegistrableDomain,
      keywords,
      probeCountries,
      userId: options.userId,
      seedSource: "ads",
    });
  }

  // No cached Meta ads: Phase 5 landing-page fallback. When disabled, honest
  // zero candidates (no fabrication). When the landing page yields no usable
  // value-prop keywords, also zero candidates.
  if (!enableLandingPageFallback) {
    return [];
  }
  const landingPageHtml = await fetchCustomerLandingPageHtml(
    `https://${ownRegistrableDomain}/`,
  );
  if (!landingPageHtml) {
    return [];
  }
  const keywords = extractLandingPageProbeKeywords(landingPageHtml, maxKeywordProbes);
  if (keywords.length === 0) {
    return [];
  }
  const probeCountries =
    options.country.trim().toLowerCase() === "all"
      ? [...LANDING_PAGE_DEFAULT_PROBE_COUNTRIES]
      : [options.country];
  return runSeedProbes(env, {
    provider,
    ownRegistrableDomain,
    keywords,
    probeCountries,
    userId: options.userId,
    seedSource: "landing_page",
  });
}
