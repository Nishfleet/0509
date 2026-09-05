import {
  buildDiscoveryCacheKey,
  readDiscoveryCacheEntryCacheOnly,
} from "~/lib/discovery-cache.server";
import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import { deriveHook, deriveOffer } from "~/lib/analysis.server";
import { listWatchlists } from "~/lib/data.server";
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
}

interface ProbeHit {
  keyword: string;
  country: string;
  ads: AdRecord[];
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

/**
 * The pure library function. Reads only cached discovery entries and the
 * customer's existing watchlists — never a live provider. Returns ranked
 * candidate competitors not already watched, each with an overlapScore and a
 * provenance string, or an empty array when the customer's own domain has no
 * cached ads (no fabrication).
 */
export async function seedAutoCompetitors(
  env: AppEnv,
  options: AutoCompetitorSeedOptions,
): Promise<AutoCompetitorCandidate[]> {
  if (!env.DB) {
    return [];
  }

  // The provider labels the cache-key namespace; the cache-only read below
  // never falls through to a live provider, so "demo" here is just a key
  // namespace, not a fabrication source. In production demo mode no cache
  // entries exist, so the read returns null and we honestly yield []. In tests
  // the harness seeds real fixture ads under this provider label.
  const provider = resolveCommercialDiscoveryProvider(env);

  const intent = parseSearchInputFromWebsiteField(options.domain);
  if (intent.intent !== "domain" || !intent.registrableDomain) {
    return [];
  }
  const ownRegistrableDomain = intent.registrableDomain;

  const maxKeywordProbes = Math.max(1, options.maxKeywordProbes ?? 8);

  // 1. Read the customer's own ads from the discovery cache (cache-only — no
  //    live scrape, no quota burn). No entry or zero ads => zero candidates,
  //    honestly.
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
  if (ownAds.length === 0) {
    return [];
  }

  // 2. Extract probe keywords + countries from the customer's own ads.
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

  // 3. Run keyword-expanded probes through the discovery cache (cache-only).
  const hits: ProbeHit[] = [];
  for (const keyword of keywords) {
    for (const country of probeCountries) {
      const probeKey = buildKeywordProbeCacheKey({
        provider,
        keyword,
        country,
      });
      const entry = await readDiscoveryCacheEntryCacheOnly(env, {
        provider,
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

  // 4. Aggregate advertisers across probes, excluding the customer's own
  //    brand (by registrable domain).
  const aggregated = new Map<string, AggregatedCandidate>();
  for (const hit of hits) {
    for (const ad of hit.ads) {
      const candidateDomain = registrableDomainFromLandingPage(ad.landingPageUrl);
      if (candidateDomain && candidateDomain === ownRegistrableDomain) {
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

  // 5. Dedup against the customer's existing watchlists via website-identity
  //    (registrable domain match — the core of resolveWebsiteIdentity).
  const watched = await listWatchlists(env, options.userId);
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
    const provenance =
      `meta_ad_library_keyword_probe: ${agg.provenanceParts.join("; ")}. ` +
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

  // 6. Rank by overlap score descending, then advertiser name for stability.
  candidates.sort((a, b) => {
    if (b.overlapScore !== a.overlapScore) {
      return b.overlapScore - a.overlapScore;
    }
    return a.advertiser.localeCompare(b.advertiser);
  });

  return candidates;
}
