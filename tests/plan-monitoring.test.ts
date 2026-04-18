import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, WatchlistRecord } from "~/lib/types";

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  isActive: true,
  lastScannedAt: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

const baseAd: AdRecord = {
  metaAdId: "meta-nykaa-1",
  advertiser: "Nykaa",
  body: "Flat 30% off",
  previewHeadline: "Glow sale",
  previewSubhead: "Weekend only",
  hook: "Glow sale",
  offer: "Flat 30% off",
  cta: "Shop now",
  format: "image",
  languageLabel: "English",
  destinationType: "website",
  landingPageUrl: "https://example.com/new-url",
  adSnapshotUrl: null,
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "demo",
  analysisFields: [],
};

function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: "obs-1",
    ad_id: "meta-nykaa-1",
    watchlist_run_id: "run-1",
    landing_page_snapshot_id: null,
    landing_page_url: "https://example.com/new-url",
    normalized_headline_hash: null,
    raw_headline: null,
    seen_at: "2026-03-28T00:00:00.000Z",
    is_active: 1,
    metadata_json: JSON.stringify({ advertiser: "Nykaa" }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runWeeklyDigests", () => {
  it("skips digest generation for free-plan users", async () => {
    const listWatchlists = vi.fn().mockResolvedValue([
      {
        id: "watch-1",
        name: "boAt watch",
      },
    ]);

    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createEventCandidate: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createProofCapture: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn(),
      countProofCapturesForWorkspaceSince: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn(),
      listRecentWorkspaceProofCaptures: vi.fn(),
      listSuccessfulProofCapturesForAd: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEvents: vi.fn(),
      listWatchEventsBetween: vi.fn().mockResolvedValue([]),
      listWatchlists,
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertProofTarget: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");

    const result = await runWeeklyDigests({
      DB: {
        prepare() {
          return {
            async all<T>() {
              return {
                results: [
                  {
                    id: "user-1",
                    email: "owner@example.com",
                    name: "Owner",
                  },
                ] as T[],
              };
            },
            bind() {
              return {
                async all<T>() {
                  return {
                    results: [
                      {
                        id: "user-1",
                        email: "owner@example.com",
                        name: "Owner",
                      },
                    ] as T[],
                  };
                },
              };
            },
          };
        },
      },
    } as never);

    expect(result).toBe(0);
    expect(listWatchlists).not.toHaveBeenCalled();
  });
});

describe("runWatchlistManual cheap scan path", () => {
  it("stores scan-side observations and only lets proof policy decide later capture", async () => {
    const createAdObservation = vi.fn();
    const createLandingPageSnapshot = vi.fn();
    const createWatchEvent = vi.fn();
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue(null);
    const listObservationsForRun = vi.fn(async (_env: unknown, runId: string) => {
      if (runId === "run-1") {
        return [
          observation({
            landing_page_url: "https://example.com/new-url",
            normalized_headline_hash: null,
            raw_headline: null,
          }),
        ];
      }

      if (runId === "run-0") {
        return [
          observation({
            watchlist_run_id: "run-0",
            landing_page_url: "https://example.com/old-url",
            normalized_headline_hash: "hash-a",
            raw_headline: "Old headline",
          }),
        ];
      }

      return [];
    });

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
      countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
      createAdObservation,
      createDigestRun: vi.fn(),
      createEventCandidate: vi.fn().mockResolvedValue("candidate-scan-1"),
      createLandingPageSnapshot,
      createProofCapture: vi.fn(),
      createWatchEvent,
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listObservationsForRun,
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertProofTarget: vi.fn().mockResolvedValue({
        id: "target-1",
        watchlistId: "watch-1",
        adId: "meta-nykaa-1",
        landingPageUrl: "https://example.com/new-url",
        canonicalPageIdentity: "example.com/new-url",
        proofTargetIdentity: "watch-1:meta-nykaa-1:example.com/new-url",
        lastCaptureAttemptAt: null,
        lastSuccessfulProofAt: null,
        lastSuccessfulCaptureId: null,
        createdAt: "2026-04-10T00:00:01.000Z",
        updatedAt: "2026-04-10T00:00:01.000Z",
      }),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      searchAds: vi.fn().mockResolvedValue({
        ads: [baseAd],
        nextCursor: null,
        source: "demo",
      }),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await runWatchlistManual({ META_AD_LIBRARY_TOKEN: "token" } as never, watchlist);

    expect(createLandingPageSnapshot).not.toHaveBeenCalled();

    expect(createAdObservation.mock.calls[0]?.[1]).toMatchObject({
      adId: "meta-nykaa-1",
      landingPageSnapshotId: null,
      landingPageUrl: "https://example.com/new-url",
      isActive: true,
      metadata: {
        advertiser: "Nykaa",
      },
    });

    expect(createWatchEvent.mock.calls.map((call) => call[1].eventType)).toEqual([
      "landing_page_url_changed",
    ]);
    expect(captureLandingPageSnapshot).toHaveBeenCalledTimes(1);
  });

  it("detects landing-page proof-backed changes even when the cheap scan stays quiet", async () => {
    const createAdObservation = vi.fn();
    const createEventCandidate = vi.fn().mockResolvedValue("candidate-proof-1");
    const createProofCapture = vi.fn().mockResolvedValue("proof-capture-1");
    const createWatchEvent = vi.fn();
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/new-url",
      canonicalUrl: "https://example.com/new-url",
      rawHeadline: "Glow serum sale",
      normalizedHeadline: "glow serum sale",
      normalizedHeadlineHash: "hash-a",
      ctaText: "Get offer",
      priceText: "Starting at ₹499",
      formPresent: true,
      captureMethod: "browser_render",
      capturedAt: "2026-04-18T00:00:00.000Z",
      artifactKey: "landing-pages/page.html",
      metadata: {
        htmlArtifactKey: "landing-pages/page.html",
        screenshotArtifactKey: "landing-pages/page.jpeg",
        extractorVersion: "lp-signals-v1",
        extractedFieldConfidence: {
          headline: 0.95,
          ctaText: 0.9,
          priceText: 0.85,
          formPresent: 0.9,
        },
        extractionWarnings: [],
        renderMode: "mobile",
        deviceProfile: "mobile_default",
      },
    });
    const listObservationsForRun = vi.fn(async () => [
      observation({
        landing_page_url: "https://example.com/new-url",
        normalized_headline_hash: "hash-a",
        raw_headline: "Glow serum sale",
      }),
    ]);

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
      countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
      createAdObservation,
      createDigestRun: vi.fn(),
      createEventCandidate,
      createLandingPageSnapshot: vi.fn(),
      createProofCapture,
      createWatchEvent,
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
      listActiveWatchlists: vi.fn(),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listObservationsForRun,
      listProofCapturesForTarget: vi.fn().mockResolvedValue([
        {
          id: "proof-prev",
          proofTargetId: "target-1",
          status: "succeeded",
          skipReason: null,
          failureCode: null,
          failureReason: null,
          screenshotArtifactKey: null,
          htmlArtifactKey: null,
          extractedFields: {
            rawHeadline: "Glow serum sale",
            normalizedHeadline: "glow serum sale",
            normalizedHeadlineHash: "hash-a",
            ctaText: "Shop now",
            priceText: "Starting at ₹499",
            formPresent: true,
          },
          fieldConfidence: {},
          extractionWarnings: [],
          captureMetadata: {},
          renderMode: "mobile",
          deviceProfile: "mobile_default",
          extractorVersion: "lp-signals-v1",
          idempotencyKey: "proof-request:watch-1",
          attemptedAt: "2026-04-10T00:00:00.000Z",
          succeededAt: "2026-04-10T00:00:01.000Z",
          createdAt: "2026-04-10T00:00:01.000Z",
          updatedAt: "2026-04-10T00:00:01.000Z",
        },
      ]),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
      upsertProofTarget: vi.fn().mockResolvedValue({
        id: "target-1",
        watchlistId: "watch-1",
        adId: "meta-nykaa-1",
        landingPageUrl: "https://example.com/new-url",
        canonicalPageIdentity: "example.com/new-url",
        proofTargetIdentity: "watch-1:meta-nykaa-1:example.com/new-url",
        lastCaptureAttemptAt: null,
        lastSuccessfulProofAt: "2026-04-10T00:00:01.000Z",
        lastSuccessfulCaptureId: "proof-prev",
        createdAt: "2026-04-10T00:00:01.000Z",
        updatedAt: "2026-04-10T00:00:01.000Z",
      }),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      searchAds: vi.fn().mockResolvedValue({
        ads: [baseAd],
        nextCursor: null,
        source: "demo",
      }),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await runWatchlistManual({ META_AD_LIBRARY_TOKEN: "token" } as never, watchlist);

    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      { META_AD_LIBRARY_TOKEN: "token" },
      "https://example.com/new-url",
    );
    expect(createProofCapture).toHaveBeenCalledWith(
      { META_AD_LIBRARY_TOKEN: "token" },
      expect.objectContaining({
        status: "succeeded",
        proofTargetId: "target-1",
      }),
    );
    expect(createEventCandidate).toHaveBeenCalledWith(
      { META_AD_LIBRARY_TOKEN: "token" },
      expect.objectContaining({
        eventType: "landing_page_cta_changed",
        status: "confirmed",
        proofTargetId: "target-1",
      }),
    );
    expect(createWatchEvent).toHaveBeenCalledWith(
      { META_AD_LIBRARY_TOKEN: "token" },
      expect.objectContaining({
        eventType: "landing_page_cta_changed",
        proofCaptureId: "proof-capture-1",
        candidateId: "candidate-proof-1",
      }),
    );
  });
});
