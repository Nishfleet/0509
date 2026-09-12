/**
 * Demo-brand discovery freshness canary (issue #2980).
 *
 * The five flagship demo brands (demo-brand-pages.ts) are the anonymous
 * buyer's first landing path on /search (for example /search?q=allbirds.com).
 * When the Meta discovery provider is stuck (rate limit, login wall, browser
 * outage) the shared provider cooldown keeps re-arming on every failed
 * capture, and every read serves `discoveryStatus "cache_only"` with the
 * stale cache entry. That state can persist for hours — exactly the moment
 * a prospective buyer hits the flagship demo path — while every internal
 * organ stays green.
 *
 * This canary closes that gap on the same hourly gap-check rail the demo
 * proof-hole catch-up rides: it rebuilds the page-1 public-search cache key
 * for each demo brand with the exact same construction the search loader
 * uses (`parseSearchParams` on a bare `?q=<domain>` + `normalizeSavedQuery` +
 * `fingerprintSavedQuery` + `buildDiscoveryCacheKey`), reads the cache entry
 * and the shared provider cooldown from D1, and fails when a brand's freshest
 * public entry is older than an hour. The breach is reported through the
 * existing cron-failure alert path so the operator email names the stale
 * brands instead of a generic cron failure.
 *
 * Read-only: this canary never triggers a capture, never mutates discovery
 * state, and never wakes the provider — it only observes the same tables the
 * serving path reads.
 */

import {
  DEMO_BRAND_PAGE_DOMAINS,
  type DemoBrandPageDomain,
} from "~/lib/demo-brand-pages";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import {
  fingerprintSavedQuery,
  normalizeSavedQuery,
} from "~/lib/normalize";
import {
  resolveCommercialDiscoveryProvider,
} from "~/lib/ad-source.server";
import {
  getDiscoveryCacheEntry,
  getDiscoveryProviderState,
} from "~/lib/data/ads.server";
import type { AppEnv } from "~/lib/env.server";

/** The breach threshold the issue sets: cache_only for > 1h. */
export const DEMO_DISCOVERY_STALE_BREACH_MS = 60 * 60 * 1000;

export interface DemoBrandDiscoveryFreshness {
  domain: DemoBrandPageDomain | string;
  cacheKey: string;
  /** ISO 8601 fetchedAt of the freshest public-search page-1 entry, or null. */
  cacheFetchedAt: string | null;
  /** Age in ms of that entry at evaluation time, or null when no entry. */
  cacheAgeMs: number | null;
  /** Shared provider cooldown (ISO 8601), when active. */
  providerCooldownUntil: string | null;
  /** Last recorded provider failure class, when any. */
  providerFailureClass: string | null;
  breached: boolean;
}

export interface DemoBrandDiscoveryCanaryResult {
  provider: string;
  evaluatedAtMs: number;
  breachedDomains: string[];
  brands: DemoBrandDiscoveryFreshness[];
  summary: string;
}

/**
 * The page-1 public-search cache key the /search route reads for a bare
 * domain query (`/search?q=<domain>`): parseSearchParams gives mode
 * "advertiser" with the domain as the query term and the "all" country
 * filter, normalizeSavedQuery fingerprints it, and the resolver's cache key
 * is provider:fingerprint:country:page-1 with a null cursor.
 *
 * Mirrors the resolver contract (same helpers it exports), so a key here that
 * has no production entry means the demo path itself regressed — which is
 * exactly what the canary must catch.
 */
export function buildDemoBrandDiscoveryCacheKey(
  env: Pick<AppEnv, "BROWSER" | "BROWSERLESS_TOKEN" | "BROWSER_RUN_ACCOUNT_ID">,
  domain: string,
): { provider: string; cacheKey: string } {
  const provider = resolveCommercialDiscoveryProvider(env, {});
  const query = normalizeSavedQuery("advertiser", {
    query: domain,
    country: "all",
    platform: "all",
    creativeType: "all",
    status: "all",
    firstSeenFrom: "",
    lastSeenFrom: "",
  });
  const fingerprint = fingerprintSavedQuery(query);
  return {
    provider,
    cacheKey: buildDiscoveryCacheKey({
      provider,
      fingerprint,
      country: query.filters.country || "all",
      cursor: null,
    }),
  };
}

export async function readDemoBrandDiscoveryFreshness(
  env: AppEnv,
  domain: DemoBrandPageDomain | string,
  now = Date.now(),
): Promise<DemoBrandDiscoveryFreshness> {
  const { provider, cacheKey } = buildDemoBrandDiscoveryCacheKey(env, domain);
  const [entry, providerState] = await Promise.all([
    provider === "demo"
      ? Promise.resolve(null)
      : getDiscoveryCacheEntry(env, cacheKey),
    provider === "demo"
      ? Promise.resolve(null)
      : getDiscoveryProviderState(env, provider),
  ]);

  const cacheFetchedAt = entry?.fetchedAt ?? null;
  const fetchedAtMs = cacheFetchedAt ? Date.parse(cacheFetchedAt) : null;
  const cacheAgeMs =
    fetchedAtMs != null && Number.isFinite(fetchedAtMs)
      ? Math.max(0, now - fetchedAtMs)
      : null;
  const cooldownRaw =
    typeof providerState?.metadata?.cooldownUntil === "string"
      ? providerState.metadata.cooldownUntil
      : null;
  const cooldownMs = cooldownRaw ? Date.parse(cooldownRaw) : null;
  const providerCooldownUntil = cooldownRaw && cooldownMs != null && cooldownMs > now
    ? cooldownRaw
    : null;

  return {
    domain: domain as DemoBrandPageDomain | string,
    cacheKey,
    cacheFetchedAt,
    cacheAgeMs,
    providerCooldownUntil,
    providerFailureClass: providerState?.failureClass ?? null,
    breached: cacheAgeMs == null || cacheAgeMs > DEMO_DISCOVERY_STALE_BREACH_MS,
  };
}

/**
 * Hourly canary body. Returns every brand's freshness plus the breach
 * summary. Never throws for a stale entry — the caller decides what a breach
 * means (operator alert), and a probe error there is reported by the
 * scheduled handler like every other rail task.
 */
export async function inspectDemoBrandDiscoveryFreshness(
  env: AppEnv,
  now = Date.now(),
): Promise<DemoBrandDiscoveryCanaryResult> {
  const provider = resolveCommercialDiscoveryProvider(env, {});
  const brands: DemoBrandDiscoveryFreshness[] = [];
  for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
    brands.push(await readDemoBrandDiscoveryFreshness(env, domain, now));
  }
  const breachedDomains = brands.filter((b) => b.breached).map((b) => b.domain);
  return {
    provider,
    evaluatedAtMs: now,
    breachedDomains,
    brands,
    summary:
      breachedDomains.length > 0
        ? `demo-brand-discovery stale >1h: ${breachedDomains.join(", ")}`
        : `demo-brand-discovery fresh (${brands.length} brands)`,
  };
}

/**
 * Scheduled-rail entry (hourly gap-check cron, workers/app.ts): alert the
 * operator when any demo brand's public discovery cache is older than an
 * hour. Healthy probes stay silent apart from one console.info line.
 */
export async function runDemoBrandDiscoveryCanary(
  env: AppEnv,
): Promise<DemoBrandDiscoveryCanaryResult> {
  const result = await inspectDemoBrandDiscoveryFreshness(env);
  if (result.breachedDomains.length > 0) {
    const { reportScheduledTaskFailure } = await import(
      "~/lib/cron-failure-alert.server"
    );
    const breach = new Error(result.summary);
    breach.name = "DemoDiscoveryStale";
    await reportScheduledTaskFailure(env, "demo_brand_discovery_canary", breach, {
      breachedDomains: result.breachedDomains.join(","),
      brands: JSON.stringify(
        result.brands.map((b) => ({
          domain: b.domain,
          cacheAgeHours: b.cacheAgeMs == null ? null : Math.round((b.cacheAgeMs / 3600000) * 10) / 10,
          cacheFetchedAt: b.cacheFetchedAt,
          providerCooldownUntil: b.providerCooldownUntil,
          providerFailureClass: b.providerFailureClass,
        })),
      ),
    });
    console.warn("demo-brand discovery canary breached", {
      breached: result.summary,
    });
    return result;
  }
  console.info(`demo-brand discovery canary green (${result.provider})`);
  return result;
}

export { DEMO_BRAND_PAGE_DOMAINS };
