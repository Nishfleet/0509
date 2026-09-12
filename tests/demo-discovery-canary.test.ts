import { describe, expect, it } from "vitest";

import {
  buildDemoBrandDiscoveryCacheKey,
  DEMO_DISCOVERY_STALE_BREACH_MS,
  inspectDemoBrandDiscoveryFreshness,
} from "~/lib/demo-discovery-canary.server";
import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import { fingerprintSavedQuery, normalizeSavedQuery } from "~/lib/normalize";
import {
  getDiscoveryCacheEntry,
  upsertDiscoveryCacheEntry,
  upsertDiscoveryProviderState,
} from "~/lib/data/ads.server";
import type { AppEnv } from "~/lib/env.server";
import type { SearchResponse } from "~/lib/types";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

function makeEnv(): { env: AppEnv; close: () => void } {
  const sqlite = createSqliteD1();
  applyMigration(sqlite.sqlite, "migrations/0008_commercial_ad_ingestion_replacement.sql");
  applyMigration(sqlite.sqlite, "migrations/0009_discovery_query_leases.sql");
  applyMigration(sqlite.sqlite, "migrations/0074_provider_neutral_discovery_failures.sql");
  return {
    // BROWSERLESS_TOKEN pins the resolver provider to meta_library_browser —
    // the production /search provider — so the canary keys land on the same
    // cache rows the serving path writes. A bare env resolved to "demo" and
    // the probe would read a nonexistent demo-provider entry.
    env: { DB: sqlite.db, BROWSERLESS_TOKEN: "probe" } as never as AppEnv,
    close: sqlite.close,
  };
}

// The bare `?q=<domain>` public search (parseSearchParams on /search?q=)
// normalizes to this exact query before the resolver builds the cache key.
function demoQuery(domain: string) {
  return normalizeSavedQuery("advertiser", {
    query: domain,
    country: "all",
    platform: "all",
    creativeType: "all",
    status: "all",
    firstSeenFrom: "",
    lastSeenFrom: "",
  });
}

const emptyPayload = {
  ads: [],
  nextCursor: null,
  source: "meta_library_browser",
  provider: "meta_library_browser",
} as never as SearchResponse;

describe("demo-brand discovery canary (issue #2980)", () => {
  it("rebuilds the page-1 public-search cache key the resolver reads", () => {
    const env = { BROWSERLESS_TOKEN: "t" } as never as AppEnv;
    for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
      const { provider, cacheKey } = buildDemoBrandDiscoveryCacheKey(env, domain);
      const expected = buildDiscoveryCacheKey({
        provider: "meta_library_browser",
        fingerprint: fingerprintSavedQuery(demoQuery(domain)),
        country: "all",
        cursor: null,
      });
      expect(provider).toBe("meta_library_browser");
      expect(cacheKey).toBe(expected);
    }
  });

  it("breaches when a brand's freshest public entry is older than an hour", async () => {
    const { env, close } = makeEnv();
    try {
      const domain = DEMO_BRAND_PAGE_DOMAINS[0];
      const fingerprint = fingerprintSavedQuery(demoQuery(domain));
      const cacheKey = buildDiscoveryCacheKey({
        provider: "meta_library_browser",
        fingerprint,
        country: "all",
        cursor: null,
      });
      await upsertDiscoveryCacheEntry(env, {
        cacheKey,
        provider: "meta_library_browser",
        routeContext: "public_search",
        queryFingerprint: fingerprint,
        country: "all",
        cursor: null,
        payload: emptyPayload,
        fetchedAt: new Date(Date.now() - (DEMO_DISCOVERY_STALE_BREACH_MS + 60_000)).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      const result = await inspectDemoBrandDiscoveryFreshness(
        env,
        Date.now(),
      );
      expect(result.breachedDomains).toContain(domain);
      const fresh = result.brands.find((b) => b.domain === domain)!;
      expect(fresh.breached).toBe(true);
      expect(fresh.cacheAgeMs).toBeGreaterThan(DEMO_DISCOVERY_STALE_BREACH_MS);
      expect(result.summary).toContain("stale >1h");
    } finally {
      close();
    }
  });

  it("stays green when every demo brand's public entry is fresh", async () => {
    const { env, close } = makeEnv();
    try {
      for (const domain of DEMO_BRAND_PAGE_DOMAINS) {
        const fingerprint = fingerprintSavedQuery(demoQuery(domain));
        await upsertDiscoveryCacheEntry(env, {
          cacheKey: buildDiscoveryCacheKey({
            provider: "meta_library_browser",
            fingerprint,
            country: "all",
            cursor: null,
          }),
          provider: "meta_library_browser",
          routeContext: "public_search",
          queryFingerprint: fingerprint,
          country: "all",
          cursor: null,
          payload: emptyPayload,
          fetchedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          expiresAt: new Date(Date.now() + 55 * 60_000).toISOString(),
        });
      }
      const result = await inspectDemoBrandDiscoveryFreshness(env);
      expect(result.breachedDomains).toEqual([]);
      expect(result.summary).toContain("fresh (5 brands)");
    } finally {
      close();
    }
  });

  it("breaches a brand with no public entry at all (a buyer hitting it gets nothing)", async () => {
    const { env, close } = makeEnv();
    try {
      const result = await inspectDemoBrandDiscoveryFreshness(env, Date.now());
      expect(result.breachedDomains).toEqual([...DEMO_BRAND_PAGE_DOMAINS]);
    } finally {
      close();
    }
  });

  it("exposes an active provider cooldown and last failure class for diagnosis", async () => {
    const { env, close } = makeEnv();
    try {
      await upsertDiscoveryProviderState(env, {
        provider: "meta_library_browser",
        status: "cache_only",
        failureClass: "rate_limited",
        summary: "Commercial discovery degraded; serving cached results.",
        lastSuccessAt: null,
        lastFailureAt: new Date(Date.now() - 90 * 60_000).toISOString(),
        metadata: {
          cooldownUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
      });
      const result = await inspectDemoBrandDiscoveryFreshness(env, Date.now());
      for (const brand of result.brands) {
        expect(brand.providerFailureClass).toBe("rate_limited");
        expect(brand.providerCooldownUntil).not.toBeNull();
        // With no cache entries at all every brand breaches — the canary
        // refuses to call an unreadable demo path fresh.
        expect(brand.breached).toBe(true);
      }
    } finally {
      close();
    }
  });

  it("reads back exactly the entry the canary keys on", async () => {
    const { env, close } = makeEnv();
    try {
      const domain = DEMO_BRAND_PAGE_DOMAINS[1];
      const key = buildDiscoveryCacheKey({
        provider: "meta_library_browser",
        fingerprint: fingerprintSavedQuery(demoQuery(domain)),
        country: "all",
        cursor: null,
      });
      await upsertDiscoveryCacheEntry(env, {
        cacheKey: key,
        provider: "meta_library_browser",
        routeContext: "public_search",
        queryFingerprint: fingerprintSavedQuery(demoQuery(domain)),
        country: "all",
        cursor: null,
        payload: emptyPayload,
        fetchedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
      const entry = await getDiscoveryCacheEntry({ DB: env.DB } as never,
        buildDemoBrandDiscoveryCacheKey(
          { BROWSERLESS_TOKEN: "t" } as never as AppEnv,
          domain,
        ).cacheKey,
      );
      expect(entry?.fetchedAt).not.toBeNull();
    } finally {
      close();
    }
  });
});
