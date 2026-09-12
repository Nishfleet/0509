import { describe, expect, it } from "vitest";

import { upsertDiscoveryCacheEntry } from "~/lib/data.server";
import {
  buildCandidateId,
  buildKeywordProbeCacheKey,
  buildOwnDomainCacheKey,
  extractProbeKeywords,
  seedAutoCompetitors,
} from "~/lib/auto-competitor-seed.server";
import { resolveCommercialDiscoveryProvider } from "~/lib/ad-source.server";
import {
  dismissCompetitorSuggestion,
  isCompetitorSuggestionDismissed,
  listDismissedSuggestionKeys,
} from "~/lib/competitor-suggestion-dismissal.server";

import { appEnv, db, ISO_T0, seedUser } from "./fixtures";

/**
 * Onboarding epic slice 2 (#3175): the dismissal store.
 *
 * This is a MIGRATION-backed test and it runs on real workerd + D1 with the
 * repo's real `migrations/*.sql` applied by `tests/integration/setup.ts`
 * (`applyD1Migrations`). That matters: the whole point of the feature is that
 * a removed suggestion has somewhere durable to live, and a mocked-binding
 * unit test cannot see a schema. This test asserts BOTH paths against the real
 * tables:
 *
 *   1. the WRITE path — `dismissCompetitorSuggestion` writes a row, is
 *      idempotent, and is visible to `isCompetitorSuggestionDismissed`;
 *   2. the READ path — `seedAutoCompetitors` filters a dismissed candidate out
 *      of its next derivation, which is what makes "removing one never
 *      re-suggests it" true rather than a UI-only hide.
 *
 * The seed is the single derivation point for the panel, the accept action and
 * the logged-out preview, so filtering there is what covers every surface.
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

/**
 * Seed the customer's own domain plus one keyword probe that surfaces `Rothy's`
 * and `Vivaia` alongside the customer's own brand. Returns the exact candidate
 * key the seed will build for `Rothy's`.
 */
async function seedTwoCandidateSweep(userId: string) {
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

  const keywords = extractProbeKeywords(ownAds, 8);
  const keyword = keywords[0]!;
  const probeKey = buildKeywordProbeCacheKey({
    provider: PROVIDER,
    keyword,
    country: "United States",
  });
  await seedCacheEntry(probeKey, [
    fixtureAd({
      metaAdId: "ad-rothys-1",
      advertiser: "Rothy's",
      advertiserPageId: null,
      body: "Wool runners, machine washable.",
      previewHeadline: "Wool runners",
      cta: "Shop now",
      landingPageUrl: "https://rothys.com",
      countries: ["United States"],
    }),
    fixtureAd({
      metaAdId: "ad-vivaia-1",
      advertiser: "Vivaia",
      advertiserPageId: null,
      body: "Wool runners, free returns.",
      previewHeadline: "Wool runners",
      cta: "Shop now",
      landingPageUrl: "https://vivaia.com",
      countries: ["United States"],
    }),
    fixtureAd({
      metaAdId: "ad-allbirds-own-2",
      advertiser: "Allbirds",
      advertiserPageId: "1000001",
      body: "Wool runners for every day.",
      previewHeadline: "Wool runners",
      cta: "Shop now",
      landingPageUrl: "https://allbirds.com",
      countries: ["United States"],
    }),
  ]);

  return buildCandidateId({
    advertiser: "Rothy's",
    registrableDomain: "rothys.com",
    advertiserPageId: null,
  });
}

describe("competitor suggestion dismissal — slice 2 (#3175)", () => {
  it("writes a dismissal, reads it back, and is idempotent", async () => {
    const userId = await seedUser();
    const key = "rothy's|rothys.com|";

    expect(await isCompetitorSuggestionDismissed(appEnv, userId, key)).toBe(false);
    expect(await dismissCompetitorSuggestion(appEnv, {
      userId,
      candidateKey: key,
      candidateDomain: "rothys.com",
      candidateLabel: "Rothy's",
    })).toBe(true);

    // READ path.
    expect(await isCompetitorSuggestionDismissed(appEnv, userId, key)).toBe(true);
    expect([...(await listDismissedSuggestionKeys(appEnv, userId))]).toEqual([key]);

    // Idempotent: the unique (user_id, candidate_key) index plus INSERT OR
    // IGNORE means a double dismissal is a no-op, not an error or a duplicate.
    await dismissCompetitorSuggestion(appEnv, {
      userId,
      candidateKey: key,
      candidateDomain: "rothys.com",
      candidateLabel: "Rothy's",
    });
    const count = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM competitor_suggestion_dismissal WHERE user_id = ?`,
      )
      .bind(userId)
      .first<{ n: number }>();
    expect(Number(count?.n ?? 0)).toBe(1);
  });

  it("scopes dismissals per user (one workspace never hides another's suggestion)", async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const key = "vivaia|vivaia.com|";
    await dismissCompetitorSuggestion(appEnv, { userId: alice, candidateKey: key });

    expect(await isCompetitorSuggestionDismissed(appEnv, alice, key)).toBe(true);
    expect(await isCompetitorSuggestionDismissed(appEnv, bob, key)).toBe(false);
    expect((await listDismissedSuggestionKeys(appEnv, bob)).size).toBe(0);
  });

  it("filters the dismissed candidate out of the next seed derivation", async () => {
    const userId = await seedUser();
    const key = await seedTwoCandidateSweep(userId);

    // Baseline: the sweep surfaces both candidates.
    const before = await seedAutoCompetitors(appEnv, {
      domain: "allbirds.com",
      country: "all",
      userId,
    });
    const beforeNames = before.map((c) => c.advertiser).sort();
    expect(beforeNames).toEqual(["Rothy's", "Vivaia"]);

    // Every candidate carries the slice-2 fields.
    for (const candidate of before) {
      expect(typeof candidate.why).toBe("string");
      expect(candidate.why.length).toBeGreaterThan(0);
      expect(["ad_keyword_overlap", "landing_page_seed"]).toContain(candidate.source);
    }

    // Remove Rothy's.
    await dismissCompetitorSuggestion(appEnv, {
      userId,
      candidateKey: key,
      candidateDomain: "rothys.com",
      candidateLabel: "Rothy's",
    });

    // READ path: the SAME derivation no longer returns it...
    const after = await seedAutoCompetitors(appEnv, {
      domain: "allbirds.com",
      country: "all",
      userId,
    });
    expect(after.map((c) => c.advertiser)).toEqual(["Vivaia"]);

    // ...and re-running the derivation does not resurrect it, which is the
    // regression this feature exists to prevent (the panel derives on every
    // load, so a non-durable removal would come straight back).
    const again = await seedAutoCompetitors(appEnv, {
      domain: "allbirds.com",
      country: "all",
      userId,
    });
    expect(again.map((c) => c.advertiser)).toEqual(["Vivaia"]);
  });

  it("does not touch other candidates' derivations", async () => {
    const userId = await seedUser();
    await seedTwoCandidateSweep(userId);
    // Dismiss a key that matches nothing in the sweep.
    await dismissCompetitorSuggestion(appEnv, {
      userId,
      candidateKey: "nobody|nobody.com|",
    });

    const after = await seedAutoCompetitors(appEnv, {
      domain: "allbirds.com",
      country: "all",
      userId,
    });
    expect(after.map((c) => c.advertiser).sort()).toEqual(["Rothy's", "Vivaia"]);
  });
});
