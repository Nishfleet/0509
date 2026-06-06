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
  vi.doUnmock("~/lib/ad-source.server");
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
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
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

  it("delegates digest delivery to the delivery module after building the digest run", async () => {
    const addDigestItem = vi.fn();
    const createDigestRun = vi.fn().mockResolvedValue("digest-1");
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    });

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem,
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun,
      createEventCandidate: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createProofCapture: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn(),
      countProofCapturesForWorkspaceSince: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn().mockResolvedValue(null),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
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
      listWatchEventsBetween: vi.fn().mockResolvedValue([
        {
          id: "event-1",
          eventType: "landing_page_offer_changed",
          status: "confirmed",
          importanceScore: 79,
          title: "Landing page offer changed",
          summary: "Offer changed on the landing page.",
        },
      ]),
      listWatchlists: vi.fn().mockResolvedValue([
        {
          id: "watch-1",
          name: "boAt watch",
        },
      ]),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertProofTarget: vi.fn(),
      upsertAd: vi.fn(),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
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

    expect(result).toBe(1);
    expect(createDigestRun).toHaveBeenCalled();
    expect(addDigestItem).toHaveBeenCalledWith(
      expect.anything(),
      "digest-1",
      expect.objectContaining({
        watchlistId: "watch-1",
        eventType: "landing_page_offer_changed",
      }),
    );
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        accountEmail: "owner@example.com",
        digestRunId: "digest-1",
        items: [
          expect.objectContaining({
            eventId: "event-1",
            watchlistName: "boAt watch",
          }),
        ],
      }),
    );
  });

  it("passes the scheduled monitoring timestamp into weekly digest generation", async () => {
    const createDigestRun = vi.fn().mockResolvedValue("digest-1");
    const getDigestByPeriod = vi.fn().mockResolvedValue(null);
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    });

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        failureClass = "browser_launch_failed" as const;
      },
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun,
      createEventCandidate: vi.fn(),
      createProofCapture: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn(),
      countProofCapturesForWorkspaceSince: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod,
      getUserDeliveryProfile: vi.fn(),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn().mockResolvedValue([]),
      listProofCapturesForTarget: vi.fn(),
      listRecentWorkspaceProofCaptures: vi.fn(),
      listSuccessfulProofCapturesForAd: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEvents: vi.fn(),
      listWatchEventsBetween: vi.fn().mockResolvedValue([
        {
          id: "event-1",
          eventType: "landing_page_offer_changed",
          status: "confirmed",
          importanceScore: 79,
          title: "Landing page offer changed",
          summary: "Offer changed on the landing page.",
        },
      ]),
      listWatchlists: vi.fn().mockResolvedValue([
        {
          id: "watch-1",
          name: "boAt watch",
        },
      ]),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertProofTarget: vi.fn(),
      upsertAd: vi.fn(),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWatchlistAlerts: vi.fn().mockResolvedValue({ attempts: 0, channels: [] }),
      deliverWeeklyDigest,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
    const scheduledTime = Date.parse("2026-04-20T05:00:00.000Z");

    const result = await runScheduledMonitoring(
      {
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
            };
          },
        },
      } as never,
      {
        includeDigests: true,
        cron: "0 5 * * MON",
        scheduledTime,
      },
    );

    expect(result).toMatchObject({
      queued: 0,
      duplicates: 0,
      inlineRuns: 0,
      digests: 1,
    });
    expect(getDigestByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "2026-04-13T05:00:00.000Z",
      "2026-04-20T05:00:00.000Z",
    );
  });

  it("keeps customer digests limited to trusted or exceptional provisional events", async () => {
    const addDigestItem = vi.fn();
    const createDigestRun = vi.fn().mockResolvedValue("digest-1");
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    });

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem,
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun,
      createEventCandidate: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createProofCapture: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn(),
      countProofCapturesForWorkspaceSince: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn().mockResolvedValue(null),
      getUserDeliveryProfile: vi.fn(),
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
      listWatchEventsBetween: vi.fn().mockResolvedValue([
        {
          id: "event-confirmed",
          eventType: "landing_page_offer_changed",
          status: "confirmed",
          importanceScore: 72,
          title: "Landing page offer changed",
          summary: "Offer changed on the landing page.",
        },
        {
          id: "event-provisional-strong",
          eventType: "landing_page_cta_changed",
          status: "proof_pending",
          importanceScore: 90,
          title: "Possible CTA change",
          summary: "A high-priority CTA change is waiting on proof.",
        },
        {
          id: "event-provisional-low",
          eventType: "landing_page_form_changed",
          status: "proof_pending",
          importanceScore: 84,
          title: "Possible form change",
          summary: "A low-priority form change is waiting on proof.",
        },
        {
          id: "event-proof-failed",
          eventType: "landing_page_cta_changed",
          status: "proof_failed",
          importanceScore: 99,
          title: "Proof failed",
          summary: "Proof capture failed.",
        },
        {
          id: "event-suppressed",
          eventType: "landing_page_cta_changed",
          status: "suppressed",
          importanceScore: 99,
          title: "Suppressed duplicate",
          summary: "Duplicate proof diff.",
        },
        {
          id: "event-invalidated",
          eventType: "landing_page_headline_changed",
          status: "invalidated",
          importanceScore: 99,
          title: "Invalidated change",
          summary: "No material proof diff.",
        },
      ]),
      listWatchlists: vi.fn().mockResolvedValue([
        {
          id: "watch-1",
          name: "Nykaa watch",
        },
      ]),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertProofTarget: vi.fn(),
      upsertAd: vi.fn(),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
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
          };
        },
      },
    } as never);

    expect(result).toBe(1);
    expect(createDigestRun).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        totalEvents: 2,
      }),
    );
    expect(addDigestItem.mock.calls.map((call) => call[2].title)).toEqual([
      "Landing page offer changed",
      "Possible CTA change",
    ]);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        items: [
          expect.objectContaining({ eventId: "event-confirmed" }),
          expect.objectContaining({ eventId: "event-provisional-strong" }),
        ],
      }),
    );
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
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
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
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWatchlistAlerts: vi.fn().mockResolvedValue({
        attempts: 0,
        channels: [],
      }),
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

    await runWatchlistManual(
      { ALLOW_PLATFORM_META_API_FALLBACK: "true", META_AD_LIBRARY_TOKEN: "token" } as never,
      watchlist,
    );

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
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
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
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWatchlistAlerts: vi.fn().mockResolvedValue({
        attempts: 0,
        channels: [],
      }),
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

    await runWatchlistManual(
      { ALLOW_PLATFORM_META_API_FALLBACK: "true", META_AD_LIBRARY_TOKEN: "token" } as never,
      watchlist,
    );

    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      "https://example.com/new-url",
    );
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        status: "succeeded",
        proofTargetId: "target-1",
      }),
    );
    expect(createEventCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        eventType: "landing_page_cta_changed",
        status: "confirmed",
        proofTargetId: "target-1",
      }),
    );
    expect(createWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        eventType: "landing_page_cta_changed",
        proofCaptureId: "proof-capture-1",
        candidateId: "candidate-proof-1",
      }),
    );
  });

  it("captures direct competitor website proof for onboarding offer changes", async () => {
    const createEventCandidate = vi.fn().mockResolvedValue("candidate-direct-1");
    const createProofCapture = vi.fn().mockResolvedValue("proof-direct-1");
    const createWatchEvent = vi.fn().mockResolvedValue("event-direct-1");
    const finishWatchlistRun = vi.fn();
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    });
    const websiteWatchlist: WatchlistRecord = {
      ...watchlist,
      targetId: "https://competitor.example/onboarding",
      targetFingerprint: "fp-competitor-website",
      targetLabel: "Competitor",
    };
    const previousProofAt = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString();
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://competitor.example/onboarding",
      canonicalUrl: "https://competitor.example/onboarding",
      rawHeadline: "Move your sales team in one day",
      normalizedHeadline: "move your sales team in one day",
      normalizedHeadlineHash: "hash-direct-current",
      ctaText: "Claim migration",
      priceText: "Free migration and 2 months white-glove setup",
      formPresent: true,
      captureMethod: "browser_render",
      capturedAt: "2026-04-18T00:00:00.000Z",
      artifactKey: "landing-pages/direct.html",
      metadata: {
        htmlArtifactKey: "landing-pages/direct.html",
        screenshotArtifactKey: "landing-pages/direct.jpeg",
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

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        failureClass = "browser_launch_failed" as const;
      },
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue({
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
      countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createEventCandidate,
      createLandingPageSnapshot: vi.fn(),
      createProofCapture,
      createWatchEvent,
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun,
      getDigestByPeriod: vi.fn(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([]),
      listActiveWatchlists: vi.fn(),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listObservationsForRun: vi.fn().mockResolvedValue([]),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([
        {
          id: "proof-prev",
          proofTargetId: "target-direct-1",
          status: "succeeded",
          skipReason: null,
          failureCode: null,
          failureReason: null,
          screenshotArtifactKey: null,
          htmlArtifactKey: null,
          extractedFields: {
            rawHeadline: "Move your sales team in one day",
            normalizedHeadline: "move your sales team in one day",
            normalizedHeadlineHash: "hash-direct-current",
            ctaText: "Book demo",
            priceText: "Paid onboarding setup",
            formPresent: true,
          },
          fieldConfidence: {},
          extractionWarnings: [],
          captureMetadata: {},
          renderMode: "mobile",
          deviceProfile: "mobile_default",
          extractorVersion: "lp-signals-v1",
          idempotencyKey: "proof-request:watch-1:direct-prev",
          attemptedAt: previousProofAt,
          succeededAt: previousProofAt,
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
        id: "target-direct-1",
        watchlistId: "watch-1",
        adId: null,
        landingPageUrl: "https://competitor.example/onboarding",
        canonicalPageIdentity: "competitor.example/onboarding",
        proofTargetIdentity: "watch-1:direct:competitor.example/onboarding",
        lastCaptureAttemptAt: null,
        lastSuccessfulProofAt: previousProofAt,
        lastSuccessfulCaptureId: "proof-prev",
        createdAt: "2026-04-10T00:00:01.000Z",
        updatedAt: "2026-04-10T00:00:01.000Z",
      }),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWatchlistAlerts,
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

    const result = await runWatchlistManual(
      { ALLOW_PLATFORM_META_API_FALLBACK: "true", META_AD_LIBRARY_TOKEN: "token" } as never,
      websiteWatchlist,
    );

    expect(result.events).toBeGreaterThan(0);
    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      "https://competitor.example/onboarding",
      expect.objectContaining({ preferRendered: true }),
    );
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        status: "succeeded",
        proofTargetId: "target-direct-1",
        captureMetadata: expect.objectContaining({
          source: "direct_competitor_website",
          watchlistTargetId: "https://competitor.example/onboarding",
        }),
      }),
    );
    expect(createEventCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        eventType: "landing_page_offer_changed",
        status: "confirmed",
        adId: null,
        proofTargetId: "target-direct-1",
        metadata: expect.objectContaining({
          source: "direct_competitor_website",
          from: "Paid onboarding setup",
          to: "Free migration and 2 months white-glove setup",
        }),
      }),
    );
    expect(createWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        eventType: "landing_page_offer_changed",
        proofCaptureId: "proof-direct-1",
        candidateId: "candidate-direct-1",
      }),
    );
    expect(deliverWatchlistAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            eventType: "landing_page_offer_changed",
          }),
        ]),
      }),
    );
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      "run-1",
      expect.objectContaining({
        summary: expect.objectContaining({
          websiteProofUrl: "https://competitor.example/onboarding",
          proofsAttempted: 1,
          events: expect.any(Number),
        }),
      }),
    );
  });

  it("still captures direct competitor website proof when ad discovery fails", async () => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "browser_launch_failed" as const;
    }

    const createEventCandidate = vi.fn().mockResolvedValue("candidate-direct-1");
    const createProofCapture = vi.fn().mockResolvedValue("proof-direct-1");
    const createWatchEvent = vi.fn().mockResolvedValue("event-direct-1");
    const finishWatchlistRun = vi.fn();
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    });
    const websiteWatchlist: WatchlistRecord = {
      ...watchlist,
      targetId: "https://competitor.example/onboarding",
      targetFingerprint: "fp-competitor-website",
      targetLabel: "Competitor",
    };
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://competitor.example/onboarding",
      canonicalUrl: "https://competitor.example/onboarding",
      rawHeadline: "Move your sales team in one day",
      normalizedHeadline: "move your sales team in one day",
      normalizedHeadlineHash: "hash-direct-current",
      ctaText: "Claim migration",
      priceText: "Free migration and 2 months white-glove setup",
      formPresent: true,
      captureMethod: "landing_page_fetch",
      capturedAt: "2026-04-18T00:00:00.000Z",
      artifactKey: "landing-pages/direct.html",
      metadata: {
        htmlArtifactKey: "landing-pages/direct.html",
        screenshotArtifactKey: "landing-pages/direct.jpeg",
        extractorVersion: "lp-signals-v1",
        extractedFieldConfidence: {},
        extractionWarnings: [],
        renderMode: "mobile",
        deviceProfile: "mobile_default",
      },
    });

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: MockCommercialDiscoveryError,
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn().mockRejectedValue(
        new MockCommercialDiscoveryError("Browser discovery unavailable"),
      ),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
      countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createEventCandidate,
      createLandingPageSnapshot: vi.fn(),
      createProofCapture,
      createWatchEvent,
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun,
      getDigestByPeriod: vi.fn(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([]),
      listActiveWatchlists: vi.fn(),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listObservationsForRun: vi.fn().mockResolvedValue([]),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([
        {
          id: "proof-prev",
          proofTargetId: "target-direct-1",
          status: "succeeded",
          skipReason: null,
          failureCode: null,
          failureReason: null,
          screenshotArtifactKey: null,
          htmlArtifactKey: null,
          extractedFields: {
            rawHeadline: "Move your sales team in one day",
            normalizedHeadline: "move your sales team in one day",
            normalizedHeadlineHash: "hash-direct-current",
            ctaText: "Book demo",
            priceText: "Paid onboarding setup",
            formPresent: true,
          },
          fieldConfidence: {},
          extractionWarnings: [],
          captureMetadata: {},
          renderMode: "mobile",
          deviceProfile: "mobile_default",
          extractorVersion: "lp-signals-v1",
          idempotencyKey: "proof-request:watch-1:direct-prev",
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
        id: "target-direct-1",
        watchlistId: "watch-1",
        adId: null,
        landingPageUrl: "https://competitor.example/onboarding",
        canonicalPageIdentity: "competitor.example/onboarding",
        proofTargetIdentity: "watch-1:none:competitor.example/onboarding",
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
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWatchlistAlerts,
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

    const result = await runWatchlistManual({} as never, websiteWatchlist);

    expect(result.events).toBeGreaterThan(0);
    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://competitor.example/onboarding",
      expect.objectContaining({ preferRendered: true }),
    );
    expect(createEventCandidate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "landing_page_offer_changed",
        proofTargetId: "target-direct-1",
      }),
    );
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        status: "succeeded",
        summary: expect.objectContaining({
          scanStatus: "degraded",
          scanErrorCode: "browser_launch_failed",
          events: expect.any(Number),
        }),
      }),
    );
	  expect(deliverWatchlistAlerts).toHaveBeenCalled();
	});

	it("keeps failed discovery failed when direct website fallback skips", async () => {
	  class MockCommercialDiscoveryError extends Error {
	    failureClass = "browser_launch_failed" as const;
	  }

	  const freshProofAt = new Date().toISOString();
	  const captureLandingPageSnapshot = vi.fn();
	  const finishWatchlistRun = vi.fn();
	  const logMetaIntegrationStatus = vi.fn();
	  const touchWatchlistScanned = vi.fn();
	  const deliverWatchlistAlerts = vi.fn();
	  const websiteWatchlist: WatchlistRecord = {
	    ...watchlist,
	    targetId: "https://competitor.example/onboarding",
	    targetFingerprint: "fp-competitor-website",
	    targetLabel: "Competitor",
	  };

	  vi.doMock("~/lib/analysis.server", () => ({
	    buildAnalysisFields: vi.fn(() => []),
	  }));
	  vi.doMock("~/lib/creative-text.server", () => ({
	    captureCreativeText: vi.fn(),
	  }));
	  vi.doMock("~/lib/ad-source.server", () => ({
	    CommercialDiscoveryError: MockCommercialDiscoveryError,
	    resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
	    searchAdsViaSourceResolver: vi.fn(),
	  }));
	  vi.doMock("~/lib/data.server", () => ({
	    addDigestItem: vi.fn(),
	    clearDigestItems: vi.fn(),
	    countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
	    countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
	    createAdObservation: vi.fn(),
	    createDigestRun: vi.fn(),
	    createEventCandidate: vi.fn(),
	    createLandingPageSnapshot: vi.fn(),
	    createProofCapture: vi.fn(),
	    createWatchEvent: vi.fn(),
	    createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
	    finishWatchlistRun,
	    getDigestByPeriod: vi.fn(),
	    getUserDeliveryProfile: vi.fn().mockResolvedValue({
	      id: "user-1",
	      email: "owner@example.com",
	      name: "Owner",
	    }),
	    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
	    getSavedQuery: vi.fn(),
	    getWatchlist: vi.fn(),
	    hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([]),
	    listActiveWatchlists: vi.fn(),
	    listEventCandidates: vi.fn().mockResolvedValue([]),
	    listObservationsForRun: vi.fn().mockResolvedValue([]),
	    listProofCapturesForTarget: vi.fn().mockResolvedValue([
	      {
	        id: "proof-prev",
	        proofTargetId: "target-direct-1",
	        status: "succeeded",
	        skipReason: null,
	        failureCode: null,
	        failureReason: null,
	        screenshotArtifactKey: null,
	        htmlArtifactKey: null,
	        extractedFields: {
	          rawHeadline: "Move your sales team in one day",
	          normalizedHeadline: "move your sales team in one day",
	          normalizedHeadlineHash: "hash-direct-current",
	          ctaText: "Book demo",
	          priceText: "Paid onboarding setup",
	          formPresent: true,
	        },
	        fieldConfidence: {},
	        extractionWarnings: [],
	        captureMetadata: {},
	        renderMode: "mobile",
	        deviceProfile: "mobile_default",
	        extractorVersion: "lp-signals-v1",
	        idempotencyKey: "proof-request:watch-1:direct-prev",
	        attemptedAt: freshProofAt,
	        succeededAt: freshProofAt,
	        createdAt: freshProofAt,
	        updatedAt: freshProofAt,
	      },
	    ]),
	    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
	    listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
	    listWatchEvents: vi.fn().mockResolvedValue([]),
	    listWatchEventsBetween: vi.fn(),
	    listWatchlists: vi.fn(),
	    logMetaIntegrationStatus,
	    touchWatchlistScanned,
	    upsertAd: vi.fn(),
	    upsertDigestDelivery: vi.fn(),
	    upsertProofTarget: vi.fn().mockResolvedValue({
	      id: "target-direct-1",
	      watchlistId: "watch-1",
	      adId: null,
	      landingPageUrl: "https://competitor.example/onboarding",
	      canonicalPageIdentity: "competitor.example/onboarding",
	      proofTargetIdentity: "watch-1:none:competitor.example/onboarding",
	      lastCaptureAttemptAt: freshProofAt,
	      lastSuccessfulProofAt: freshProofAt,
	      lastSuccessfulCaptureId: "proof-prev",
	      createdAt: freshProofAt,
	      updatedAt: freshProofAt,
	    }),
	  }));
	  vi.doMock("~/lib/landing-pages.server", () => ({
	    captureLandingPageSnapshot,
	  }));
	  vi.doMock("~/lib/delivery.server", () => ({
	    deliverWatchlistAlerts,
	  }));
	  vi.doMock("~/lib/plan.server", () => ({
	    getUserPlan: vi.fn(),
	    PLAN_LIMITS: {
	      free: { digests: false },
	      starter: { digests: true },
	      agency: { digests: true },
	    },
	  }));

	  const { runWatchlist } = await import("~/lib/monitoring.server");

	  const result = await runWatchlist(
	    {} as never,
	    websiteWatchlist,
	    "manual",
	    Promise.reject(new MockCommercialDiscoveryError("Browser discovery unavailable")),
	  );

	  expect(result.events).toBe(0);
	  expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
	  expect(deliverWatchlistAlerts).not.toHaveBeenCalled();
	  expect(touchWatchlistScanned).not.toHaveBeenCalled();
	  expect(finishWatchlistRun).toHaveBeenCalledWith(
	    expect.anything(),
	    "run-1",
	    expect.objectContaining({
	      status: "failed",
	      errorCode: "browser_launch_failed",
	      errorMessage: "Browser discovery unavailable",
	      summary: expect.objectContaining({
	        proofsAttempted: 0,
	        events: 0,
	        scanStatus: "failed",
	        scanErrorCode: "browser_launch_failed",
	      }),
	    }),
	  );
	  expect(logMetaIntegrationStatus).toHaveBeenCalledWith(
	    expect.anything(),
	    expect.objectContaining({
	      status: "degraded",
	      summary: "Commercial discovery failed and direct website proof did not complete.",
	    }),
	  );
	});

	it("does not spend direct website proof quota while the previous proof is fresh", async () => {
	  const captureLandingPageSnapshot = vi.fn();
	  const finishWatchlistRun = vi.fn();
	  const directWatchlist: WatchlistRecord = {
      ...watchlist,
      targetId: "https://competitor.example/onboarding",
      targetFingerprint: "fp-competitor-website",
      targetLabel: "Competitor",
    };

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        failureClass = "browser_launch_failed" as const;
      },
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
      countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createEventCandidate: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createProofCapture: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun,
      getDigestByPeriod: vi.fn(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([]),
      listActiveWatchlists: vi.fn(),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listObservationsForRun: vi.fn().mockResolvedValue([]),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
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
        id: "target-direct-1",
        watchlistId: "watch-1",
        adId: null,
        landingPageUrl: "https://competitor.example/onboarding",
        canonicalPageIdentity: "competitor.example/onboarding",
        proofTargetIdentity: "watch-1:none:competitor.example/onboarding",
        lastCaptureAttemptAt: new Date().toISOString(),
        lastSuccessfulProofAt: new Date().toISOString(),
        lastSuccessfulCaptureId: "proof-prev",
        createdAt: "2026-04-10T00:00:01.000Z",
        updatedAt: "2026-04-10T00:00:01.000Z",
      }),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWatchlistAlerts: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { runWatchlist } = await import("~/lib/monitoring.server");

    await runWatchlist(
      {} as never,
      directWatchlist,
      "manual",
      Promise.resolve({ ads: [], pagesScanned: 0, source: "meta_library_browser" } as never),
    );

    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        summary: expect.objectContaining({
          proofsAttempted: 0,
          events: 0,
        }),
      }),
    );
  });

  it("compares redirected direct website proof against the canonical target history", async () => {
    const createEventCandidate = vi.fn().mockResolvedValue("candidate-direct-redirect");
    const createProofCapture = vi.fn().mockResolvedValue("proof-direct-redirect");
    const createWatchEvent = vi.fn().mockResolvedValue("event-direct-redirect");
    const initialTarget = {
      id: "target-initial",
      watchlistId: "watch-1",
      adId: null,
      landingPageUrl: "https://competitor.example/onboarding",
      canonicalPageIdentity: "competitor.example/onboarding",
      proofTargetIdentity: "watch-1:none:competitor.example/onboarding",
      lastCaptureAttemptAt: null,
      lastSuccessfulProofAt: null,
      lastSuccessfulCaptureId: null,
      createdAt: "2026-04-10T00:00:01.000Z",
      updatedAt: "2026-04-10T00:00:01.000Z",
    };
    const finalTarget = {
      ...initialTarget,
      id: "target-final",
      landingPageUrl: "https://www.competitor.example/onboarding",
      canonicalPageIdentity: "www.competitor.example/onboarding",
      proofTargetIdentity: "watch-1:none:www.competitor.example/onboarding",
      lastSuccessfulProofAt: "2026-04-10T00:00:01.000Z",
      lastSuccessfulCaptureId: "proof-prev",
    };
    const upsertProofTarget = vi.fn().mockImplementation(async (_env: unknown, input: { canonicalPageIdentity: string }) =>
      input.canonicalPageIdentity === "www.competitor.example/onboarding" ? finalTarget : initialTarget,
    );
    const listProofCapturesForTarget = vi.fn().mockImplementation(async (_env: unknown, proofTargetId: string) =>
      proofTargetId === "target-final"
        ? [
            {
              id: "proof-prev",
              proofTargetId: "target-final",
              status: "succeeded",
              skipReason: null,
              failureCode: null,
              failureReason: null,
              screenshotArtifactKey: null,
              htmlArtifactKey: null,
              extractedFields: {
                rawHeadline: "Move your sales team in one day",
                normalizedHeadline: "move your sales team in one day",
                normalizedHeadlineHash: "hash-direct-current",
                ctaText: "Book demo",
                priceText: "Paid onboarding setup",
                formPresent: true,
              },
              fieldConfidence: {},
              extractionWarnings: [],
              captureMetadata: {},
              renderMode: "mobile",
              deviceProfile: "mobile_default",
              extractorVersion: "lp-signals-v1",
              idempotencyKey: "proof-request:watch-1:direct-prev",
              attemptedAt: "2026-04-10T00:00:00.000Z",
              succeededAt: "2026-04-10T00:00:01.000Z",
              createdAt: "2026-04-10T00:00:01.000Z",
              updatedAt: "2026-04-10T00:00:01.000Z",
            },
          ]
        : [],
    );
    const websiteWatchlist: WatchlistRecord = {
      ...watchlist,
      targetId: "https://competitor.example/onboarding",
      targetFingerprint: "fp-competitor-website",
      targetLabel: "Competitor",
    };
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue({
      rawUrl: "https://competitor.example/onboarding",
      canonicalUrl: "https://www.competitor.example/onboarding",
      rawHeadline: "Move your sales team in one day",
      normalizedHeadline: "move your sales team in one day",
      normalizedHeadlineHash: "hash-direct-current",
      ctaText: "Claim migration",
      priceText: "Free migration and 2 months white-glove setup",
      formPresent: true,
      captureMethod: "landing_page_fetch",
      capturedAt: "2026-04-18T00:00:00.000Z",
      artifactKey: "landing-pages/direct.html",
      metadata: {
        htmlArtifactKey: "landing-pages/direct.html",
        screenshotArtifactKey: "landing-pages/direct.jpeg",
        extractorVersion: "lp-signals-v1",
        extractedFieldConfidence: {},
        extractionWarnings: [],
        renderMode: "mobile",
        deviceProfile: "mobile_default",
      },
    });

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/ad-source.server", () => ({
      CommercialDiscoveryError: class CommercialDiscoveryError extends Error {
        failureClass = "browser_launch_failed" as const;
      },
      resolveCommercialDiscoveryProvider: vi.fn(() => "meta_library_browser"),
      searchAdsViaSourceResolver: vi.fn().mockResolvedValue({
        ads: [],
        nextCursor: null,
        source: "meta_library_browser",
      }),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
      countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createEventCandidate,
      createLandingPageSnapshot: vi.fn(),
      createProofCapture,
      createWatchEvent,
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([]),
      listActiveWatchlists: vi.fn(),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listObservationsForRun: vi.fn().mockResolvedValue([]),
      listProofCapturesForTarget,
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
      upsertProofTarget,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot,
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWatchlistAlerts: vi.fn().mockResolvedValue({
        attempts: 0,
        channels: [],
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

    const result = await runWatchlistManual({} as never, websiteWatchlist);

    expect(result.events).toBeGreaterThan(0);
    expect(listProofCapturesForTarget).toHaveBeenCalledWith(expect.anything(), "target-final", 20);
    expect(createEventCandidate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "landing_page_offer_changed",
        proofTargetId: "target-final",
        metadata: expect.objectContaining({
          from: "Paid onboarding setup",
          to: "Free migration and 2 months white-glove setup",
        }),
      }),
    );
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proofTargetId: "target-final",
        idempotencyKey: expect.stringContaining("www-competitor-example-onboarding"),
      }),
    );
  });

  it("delegates confirmed watchlist events to the instant-delivery module", async () => {
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
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
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createEventCandidate: vi.fn().mockResolvedValue("candidate-scan-1"),
      createLandingPageSnapshot: vi.fn(),
      createProofCapture: vi.fn(),
      createWatchEvent: vi.fn().mockResolvedValue("event-1"),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listObservationsForRun: vi.fn(async (env: unknown, runId: string) => {
        if (runId === "run-1") {
          return [
            observation({
              landing_page_url: "https://example.com/new-url",
            }),
          ];
        }

        if (runId === "run-0") {
          return [
            observation({
              watchlist_run_id: "run-0",
              landing_page_url: "https://example.com/old-url",
            }),
          ];
        }

        return [];
      }),
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
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWatchlistAlerts,
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

    await runWatchlistManual(
      {
        ALLOW_PLATFORM_META_API_FALLBACK: "true",
        META_AD_LIBRARY_TOKEN: "token",
      } as never,
      watchlist,
    );

    expect(deliverWatchlistAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        userId: "user-1",
        watchlist: expect.objectContaining({
          id: "watch-1",
        }),
        events: [
          expect.objectContaining({
            eventType: "landing_page_url_changed",
          }),
        ],
      }),
    );
  });
});
