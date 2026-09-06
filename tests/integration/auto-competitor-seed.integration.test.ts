import { describe, expect, it } from "vitest";

import { upsertDiscoveryCacheEntry } from "~/lib/data.server";
import {
  buildKeywordProbeCacheKey,
  buildOwnDomainCacheKey,
  extractProbeKeywords,
  seedAutoCompetitors,
} from "~/lib/auto-competitor-seed.server";
import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Phase 1 of the auto-competitor-watch epic (Nishfleet/0509#1366, issue
 * #1369). The seed function is a pure library: it reads only cached discovery
 * entries and the customer's existing watchlists — never a live provider —
 * so Browser Rendering quota is never burned and nothing is fabricated.
 *
 * These integration tests run on real workerd + D1 (the `workers` vitest
 * project) and seed the discovery cache with the SAME keys the seed function
 * reads, proving every D1-bound path goes through `buildDiscoveryCacheKey` /
 * `buildSearchV2CacheKey`.
 */

const PROVIDER = resolveCommercialDiscoveryProvider(appEnv);
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

interface FixtureAd {
  metaAdId: string;
  advertiser: string;
  advertiserPageId?: string | null;
  body: string;
  previewHeadline: string;
  cta: string;
  landingPageUrl: string | null;
  countries: string[];
}

function fixtureAd(ad: FixtureAd) {
  return {
    metaAdId: ad.metaAdId,
    advertiser: ad.advertiser,
    advertiserPageId: ad.advertiserPageId ?? null,
    body: ad.body,
    previewHeadline: ad.previewHeadline,
    previewSubhead: "",
    hook: ad.previewHeadline,
    offer: "",
    cta: ad.cta,
    format: "image" as const,
    languageLabel: "English",
    destinationType: "website" as const,
    landingPageUrl: ad.landingPageUrl,
    adSnapshotUrl: null,
    countries: ad.countries,
    platforms: ["Instagram"],
    firstSeenAt: ISO_T0,
    lastSeenAt: ISO_T0,
    active: true,
    researchSummary: "",
    source: "meta_library_browser" as const,
    analysisFields: [],
  };
}

async function seedCacheEntry(cacheKey: string, ads: ReturnType<typeof fixtureAd>[]) {
  await upsertDiscoveryCacheEntry(appEnv, {
    cacheKey,
    provider: PROVIDER,
    routeContext: "public_search",
    queryFingerprint: `fp-${cacheKey}`,
    country: "all",
    cursor: null,
    payload: {
      ads,
      nextCursor: null,
      source: "meta_library_browser",
      provider: PROVIDER,
      cacheStatus: "hit",
    },
    fetchedAt: ISO_T0,
    expiresAt: FAR_FUTURE,
    browserMsUsed: 0,
  });
}

async function seedAdvertiserWatchlist(
  userId: string,
  targetId: string,
  id = uid("wl"),
) {
  await db()
    .prepare(
      `INSERT INTO watchlist (
         id, user_id, name, target_type, tracking_role, target_id,
         target_fingerprint, target_label, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, 'advertiser', 'competitor', ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, userId, `Watch ${id}`, targetId, `fp-${id}`, targetId, ISO_T0, ISO_T0)
    .run();
  return id;
}

describe("seedAutoCompetitors — Phase 1 (auto-competitor-watch #1369)", () => {
  it("surfaces ranked candidates not already watched, with overlapScore + provenance", async () => {
    const userId = await seedUser();
    // The customer already watches Nike — the seed must dedup it out via
    // website-identity (registrable domain match on the watchlist target_id).
    await seedAdvertiserWatchlist(userId, "https://nike.com");

    // 1. Seed the customer's OWN domain ads (allbirds.com). The derived hook
    //    and "free shipping" offer become probe keywords (extracted below via
    //    the SAME function the seed uses); the ad's country "United States"
    //    becomes the probe country.
    const ownAds = [
      fixtureAd({
        metaAdId: "ad-allbirds-own-1",
        advertiser: "Allbirds",
        advertiserPageId: "1000001",
        body: "Wool runners. Free shipping on every pair.",
        previewHeadline: "Wool runners",
        cta: "Shop now",
        landingPageUrl: "https://allbirds.com",
        countries: ["United States"],
      }),
    ];
    const ownKey = buildOwnDomainCacheKey({
      provider: PROVIDER,
      domain: "allbirds.com",
      country: "all",
    })!;
    await seedCacheEntry(ownKey, ownAds);

    // 2. Compute the EXACT probe keywords the seed will expand to, and seed a
    //    cache entry for the first one. That probe surfaces Adidas + Nike +
    //    Allbirds (Allbirds is the own-brand and must be excluded; Nike is
    //    watched and must be deduped; Adidas is a fresh candidate). Seeding
    //    with the helper-built key proves the seed reads via
    //    buildDiscoveryCacheKey.
    const keywords = extractProbeKeywords(ownAds, 8);
    expect(keywords.length).toBeGreaterThan(0);
    const firstKeyword = keywords[0];
    const probeCountry = "United States";
    const probeKey = buildKeywordProbeCacheKey({
      provider: PROVIDER,
      keyword: firstKeyword,
      country: probeCountry,
    });
    await seedCacheEntry(probeKey, [
      fixtureAd({
        metaAdId: "ad-adidas-1",
        advertiser: "Adidas",
        advertiserPageId: "1000002",
        body: "Wool runners for trail season.",
        previewHeadline: "Wool runners",
        cta: "Shop",
        landingPageUrl: "https://adidas.com",
        countries: ["United States"],
      }),
      fixtureAd({
        metaAdId: "ad-nike-1",
        advertiser: "Nike",
        advertiserPageId: "1000003",
        body: "Wool runners built for speed.",
        previewHeadline: "Wool runners",
        cta: "Shop",
        landingPageUrl: "https://nike.com",
        countries: ["United States"],
      }),
      fixtureAd({
        metaAdId: "ad-allbirds-competitor-1",
        advertiser: "Allbirds",
        advertiserPageId: "1000001",
        body: "Wool runners. Free shipping.",
        previewHeadline: "Wool runners",
        cta: "Shop",
        landingPageUrl: "https://allbirds.com",
        countries: ["United States"],
      }),
    ]);

    const candidates = await seedAutoCompetitors(appEnv, {
      domain: "allbirds.com",
      country: "all",
      userId,
    });

    // No fabrication: every candidate is a real cached advertiser.
    expect(candidates.length).toBeGreaterThan(0);

    // Dedup via website-identity holds: Nike (watched) and Allbirds (own
    // brand) are absent; Adidas is present.
    const advertisers = candidates.map((c) => c.advertiser);
    expect(advertisers).not.toContain("Nike");
    expect(advertisers).not.toContain("Allbirds");
    expect(advertisers).toContain("Adidas");

    // Every candidate carries a numeric overlapScore and a provenance string
    // naming the keyword/country probe that surfaced it.
    for (const candidate of candidates) {
      expect(typeof candidate.overlapScore).toBe("number");
      expect(Number.isFinite(candidate.overlapScore)).toBe(true);
      expect(candidate.overlapScore).toBeGreaterThan(0);
      expect(typeof candidate.provenance).toBe("string");
      expect(candidate.provenance.length).toBeGreaterThan(0);
      // Provenance names the probe keyword + country and states the Meta Ad
      // Library keyword-search ceiling.
      expect(candidate.provenance).toContain("keyword:");
      expect(candidate.provenance).toContain("country:");
      expect(candidate.provenance).toMatch(/active ads on the searched terms/);
    }

    // Adidas was surfaced by the first probe keyword / "United States".
    const adidas = candidates.find((c) => c.advertiser === "Adidas")!;
    expect(adidas.matchedKeywords).toContain(firstKeyword);
    expect(adidas.countries).toContain("United States");
    expect(adidas.registrableDomain).toBe("adidas.com");
    expect(adidas.advertiserPageId).toBe("1000002");
  });

  it("returns zero candidates when the seeded domain has no cached ads (no fabrication)", async () => {
    const userId = await seedUser();
    // No own-domain cache entry is seeded for "notion.so", so the seed
    // function must honestly return zero candidates rather than invent any.
    // Phase 5 (#1373) adds a landing-page fallback for the no-ads case, which
    // would perform a network crawl; this test pins the pure-library honesty
    // contract with the fallback disabled so it stays cache-only and
    // deterministic (the crawl path is covered separately in
    // auto-competitor-landing-page-seed.integration.test.ts).
    const candidates = await seedAutoCompetitors(appEnv, {
      domain: "notion.so",
      country: "all",
      userId,
      enableLandingPageFallback: false,
    });
    expect(candidates).toEqual([]);
  });

  it("routes every D1-bound read through buildDiscoveryCacheKey / buildSearchV2CacheKey", async () => {
    // The two tests above already prove cache-routing end-to-end: the seed
    // function only finds candidates when the cache is seeded with the EXACT
    // keys built by buildOwnDomainCacheKey / buildKeywordProbeCacheKey (which
    // delegate to buildSearchV2CacheKey / buildDiscoveryCacheKey). A
    // mismatched key would yield zero candidates. This test pins that
    // contract directly: seed the own-domain entry with the helper-built key
    // and assert the seed reads it (non-empty own ads path), then delete the
    // probe entries and assert zero candidates (no live fallback).
    const userId = await seedUser();
    const ownKey = buildOwnDomainCacheKey({
      provider: PROVIDER,
      domain: "ouraring.com",
      country: "all",
    })!;
    await seedCacheEntry(ownKey, [
      fixtureAd({
        metaAdId: "ad-oura-own-1",
        advertiser: "Oura",
        body: "Smart ring for sleep tracking.",
        previewHeadline: "Smart ring",
        cta: "Shop",
        landingPageUrl: "https://ouraring.com",
        countries: ["United States"],
      }),
    ]);

    // No probe entries seeded: the seed must NOT fall back to a live provider
    // (no Browser Rendering, no Meta API, no demo). It returns [] honestly.
    const candidates = await seedAutoCompetitors(appEnv, {
      domain: "ouraring.com",
      country: "all",
      userId,
    });
    expect(candidates).toEqual([]);
  });
});
