import { describe, expect, it } from "vitest";

import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  buildKeywordProbeCacheKey,
  buildOwnDomainCacheKey,
  extractProbeKeywords,
  seedAutoCompetitors,
} from "~/lib/auto-competitor-seed.server";
import {
  listResweepUsers,
  resweepAutoCompetitors,
  resweepAutoCompetitorsForCustomer,
  runAutoCompetitorResweep,
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
  fetchedAt: string = ISO_T0,
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
    fetchedAt,
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
    // #3175 made why/source required on every probe candidate; the fixture
    // mirrors exactly what the seed's keyword-probe path produces.
    why: "Runs ads on “wool runners” in United States.",
    source: "ad_keyword_overlap" as const,
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
    await seedCacheEntry(ownKey, ownAds);

    // Brand B has already been surfaced in a previous resweep.
    await seedAutoCompetitorSurfacedCache(userId, [
      candidate("Brand B", "brandb.com"),
    ]);

    // The probe returns A, B, and C. Only C is net-new. Use the EXACT
    // extracted keyword the seed function will probe, so the cache key
    // matches what the seed function reads. extractProbeKeywords returns the
    // hook with sentence punctuation, so the keyword is "wool runners." not
    // "wool runners" — seeding with the wrong string would yield zero
    // candidates (and the diff would not be tested).
    const probeKeywords = extractProbeKeywords(ownAds, 8);
    expect(probeKeywords.length).toBeGreaterThan(0);
    const probeKeyword = probeKeywords[0];
    const probeKey = buildKeywordProbeCacheKey({
      provider: PROVIDER,
      keyword: probeKeyword,
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

    const result = await resweepAutoCompetitorsForCustomer(appEnv, {
      userId,
      domain: "allbirds.com",
      country: "all",
    });

    // The probe returned 3 advertisers (A, B, C). A is already watched and
    // deduped inside seedAutoCompetitors, so the resweep sees 2. B is in the
    // previously-surfaced set and is dropped by the diff. Only C is net-new.
    expect(result.scanned).toBe(2);
    expect(result.newlyAppeared.map((c) => c.advertiser)).toEqual(["Brand C"]);
    expect(result.newlyAppeared[0].provenance).toContain("newly_appeared");
    expect(result.newlyAppeared[0].registrableDomain).toBe("brandc.com");
  });
});

describe("listResweepUsers / runAutoCompetitorResweep — fair sweep ordering (issue #2778)", () => {
  async function seedPaidBrandedWorkspace(brandWebsite: string) {
    const userId = await seedUser();
    await db()
      .prepare(
        `INSERT INTO user_plan (user_id, plan, plan_updated_at) VALUES (?, 'agency', ?)`,
      )
      .bind(userId, ISO_T0)
      .run();
    await db()
      .prepare(
        `INSERT INTO workspace_branding (user_id, brand_website, updated_at)
         VALUES (?, ?, ?)`,
      )
      .bind(userId, brandWebsite, ISO_T0)
      .run();
    return userId;
  }

  function staggeredSweptAt(index: number) {
    // Strictly increasing per swept workspace so the fair ordering — tie-break
    // included — is fully determined by the seed data, not the clock.
    return new Date(Date.parse(ISO_T0) + index * 60_000).toISOString();
  }

  it("does not permanently starve workspaces past the user limit (oldest-swept-first ordering)", async () => {
    // 101 fresh paid+branded workspaces. Earlier tests in this file seed no
    // user_plan rows, so these are the only workspaces that qualify for the
    // sweep's user query — whole-DB assertions below stay exact.
    const seeded: string[] = [];
    for (let i = 0; i < 101; i += 1) {
      seeded.push(await seedPaidBrandedWorkspace("https://allbirds.com"));
    }
    // Alphabetical order — exactly what the old `ORDER BY user_id LIMIT ?`
    // sorted by. The never-swept workspace sits LAST, i.e. the row the old
    // identity ordering could never pick.
    const keyOrdered = [...seeded].sort((a, b) => (a < b ? -1 : 1));
    const starved = keyOrdered[keyOrdered.length - 1];

    // The first 100 key-ordered workspaces were swept before, oldest sweep
    // first; the never-swept workspace has no surfaced row at all.
    for (let i = 0; i < 100; i += 1) {
      await seedAutoCompetitorSurfacedCache(keyOrdered[i], [], staggeredSweptAt(i));
    }

    // Uncapped: all 101 qualify and the never-swept workspace sorts first.
    const uncapped = await listResweepUsers(appEnv, 100_000);
    expect(uncapped.length).toBe(101);
    expect(uncapped[0]).toBe(starved);
    expect(uncapped.slice(1)).toEqual(keyOrdered.slice(0, 100));

    // Capped at 100: the never-swept workspace is picked and the workspace
    // with the NEWEST last-sweep timestamp falls out — rotation, not a frozen
    // alphabetical prefix.
    const capped = await listResweepUsers(appEnv, 100);
    expect(capped.length).toBe(100);
    expect(capped[0]).toBe(starved);
    expect(capped).not.toContain(keyOrdered[99]);

    // End to end: the capped sweep processes the batch offline (the own-domain
    // probe is a pure cache read once ads are cached) and writes the
    // once-starved workspace's surfaced row — this sweep's cursor-row analog.
    const ownKey = buildOwnDomainCacheKey({
      provider: PROVIDER,
      domain: "allbirds.com",
      country: "all",
    })!;
    await seedCacheEntry(ownKey, [
      fixtureAd({
        metaAdId: "ad-allbirds-ordering-own",
        advertiser: "Allbirds",
        advertiserPageId: "1000000",
        body: "Wool runners. Free shipping on every pair.",
        previewHeadline: "Wool runners",
        cta: "Shop now",
        landingPageUrl: "https://allbirds.com",
        countries: ["United States"],
      }),
    ]);

    const resweep = await runAutoCompetitorResweep(
      { ...appEnv, MONITORING_FANOUT_MODE: "fanout" },
      { userLimit: 100 },
    );
    expect(resweep.skippedReason).toBeUndefined();
    expect(resweep.users).toBe(100);
    expect(resweep.errors).toBe(0);

    const starvedRow = await db()
      .prepare(
        `SELECT fetched_at FROM discovery_cache_entry
         WHERE provider = ? AND route_context = 'scheduled_warmup'
           AND query_fingerprint = ?`,
      )
      .bind(PROVIDER, `auto-competitor-surfaced:${starved}`)
      .first<{ fetched_at: string }>();
    expect(starvedRow).not.toBeNull();
    expect(Date.parse(starvedRow?.fetched_at ?? "")).toBeGreaterThan(
      Date.parse(staggeredSweptAt(99)),
    );

    // Round 2: the workspace that missed round 1 now holds the oldest
    // timestamp and sorts first; the once-starved workspace, swept seconds
    // ago, ranks behind every not-just-swept peer. Every workspace cycles
    // through the batch inside two ticks.
    const roundTwo = await listResweepUsers(appEnv, 100);
    expect(roundTwo.length).toBe(100);
    expect(roundTwo[0]).toBe(keyOrdered[99]);
  });
});
