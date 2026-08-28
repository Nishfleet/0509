import { describe, expect, it } from "vitest";

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  buildKeywordProbeCacheKey,
  buildOwnDomainCacheKey,
  seedAutoCompetitors,
} from "~/lib/auto-competitor-seed.server";
import {
  resweepAutoCompetitors,
  resweepAutoCompetitorsForCustomer,
} from "~/lib/auto-competitor-resweep.server";
import { buildDiscoveryCacheKey } from "~/lib/discovery-cache.server";
import { upsertDiscoveryCacheEntry } from "~/lib/data.server";
import type { SearchResponse } from "~/lib/types";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

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

async function seedAutoCompetitorSurfacedCache(
  userId: string,
  candidates: ReturnType<typeof candidate>[],
) {
  const fingerprint = `auto-competitor-surfaced:${userId}`;
  const cacheKey = buildDiscoveryCacheKey({
    provider: PROVIDER,
    fingerprint,
    country: "all",
    cursor: null,
  });
  await upsertDiscoveryCacheEntry(appEnv, {
    cacheKey,
    provider: PROVIDER,
    routeContext: "scheduled_warmup",
    queryFingerprint: fingerprint,
    country: "all",
    cursor: null,
    payload: {
      ads: [],
      nextCursor: null,
      source: "demo",
      provider: PROVIDER,
      cacheStatus: "hit",
      surfacedCandidates: candidates,
    } as unknown as SearchResponse,
    fetchedAt: ISO_T0,
    expiresAt: FAR_FUTURE,
    browserMsUsed: 0,
  });
}

function candidate(
  advertiser: string,
  domain: string,
  extra?: { provenance?: string; overlapScore?: number },
) {
  return {
    advertiser,
    advertiserPageId: null,
    registrableDomain: domain,
    overlapScore: extra?.overlapScore ?? 1,
    provenance:
      extra?.provenance ??
      'meta_ad_library_keyword_probe: keyword:"wool runners" country:"United States". Candidates are only advertisers with active ads on the searched terms.',
    countries: ["United States"],
    matchedKeywords: ["wool runners"],
  };
}

describe("resweepAutoCompetitors — Phase 3 (auto-competitor-watch #1371)", () => {
  it("surfaces only net-new candidates, excluding watched and already-surfaced", () => {
    const watched = new Set<string>(["branda.com"]);
    const surfaced = new Set<string>(["brandb.com"]);
    const probe = [
      candidate("Brand A", "branda.com"),
      candidate("Brand B", "brandb.com"),
      candidate("Brand C", "brandc.com"),
    ];

    const result = resweepAutoCompetitors(probe, {
      watchedDomains: watched,
      surfacedDomains: surfaced,
    });

    expect(result.map((c) => c.advertiser)).toEqual(["Brand C"]);
    expect(result[0].registrableDomain).toBe("brandc.com");
    expect(result[0].provenance).toContain("newly_appeared");
    expect(result[0].provenance).toContain("keyword:");
    expect(result[0].provenance).toContain("country:");
  });

  it("returns an empty array when the probe result is empty", () => {
    const result = resweepAutoCompetitors([], {
      watchedDomains: new Set(),
      surfacedDomains: new Set(),
    });
    expect(result).toEqual([]);
  });

  it("resweep per customer surfaces only candidates that are neither watched nor already surfaced", async () => {
    const userId = await seedUser();

    // The customer already watches Brand A.
    await seedAdvertiserWatchlist(userId, "https://branda.com");

    // The customer's own ads (allbirds.com). The hook "Wool runners" becomes
    // the probe keyword; the ad country "United States" becomes the probe
    // country.
    const ownKey = buildOwnDomainCacheKey({
      provider: PROVIDER,
      domain: "allbirds.com",
      country: "all",
    })!;
    await seedCacheEntry(ownKey, [
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
    ]);

    // Brand B has already been surfaced in a previous resweep.
    await seedAutoCompetitorSurfacedCache(userId, [
      candidate("Brand B", "brandb.com"),
    ]);

    // The probe returns A, B, and C. Only C is net-new.
    const probeKey = buildKeywordProbeCacheKey({
      provider: PROVIDER,
      keyword: "wool runners",
      country: "United States",
    });
    await seedCacheEntry(probeKey, [
      fixtureAd({
        metaAdId: "ad-branda-1",
        advertiser: "Brand A",
        advertiserPageId: "2000001",
        body: "Wool runners built for speed.",
        previewHeadline: "Wool runners",
        cta: "Shop",
        landingPageUrl: "https://branda.com",
        countries: ["United States"],
      }),
      fixtureAd({
        metaAdId: "ad-brandb-1",
        advertiser: "Brand B",
        advertiserPageId: "2000002",
        body: "Wool runners for trail season.",
        previewHeadline: "Wool runners",
        cta: "Shop",
        landingPageUrl: "https://brandb.com",
        countries: ["United States"],
      }),
      fixtureAd({
        metaAdId: "ad-brandc-1",
        advertiser: "Brand C",
        advertiserPageId: "2000003",
        body: "Wool runners made for comfort.",
        previewHeadline: "Wool runners",
        cta: "Shop",
        landingPageUrl: "https://brandc.com",
        countries: ["United States"],
      }),
    ]);

    const direct = await seedAutoCompetitors(appEnv, {
      domain: "allbirds.com",
      country: "all",
      userId,
    });
    console.log("DEBUG direct seed", {
      count: direct.length,
      advertisers: direct.map((c) => c.advertiser),
      ownKey,
      probeKey,
    });

    const result = await resweepAutoCompetitorsForCustomer(appEnv, {
      userId,
      domain: "allbirds.com",
      country: "all",
    });

    expect(result.scanned).toBe(3);
    expect(result.newlyAppeared.map((c) => c.advertiser)).toEqual(["Brand C"]);
    expect(result.newlyAppeared[0].provenance).toContain("newly_appeared");
    expect(result.newlyAppeared[0].registrableDomain).toBe("brandc.com");
  });
});
