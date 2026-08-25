import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, ProofCaptureRecord, WatchEventRecord, WatchlistRecord } from "~/lib/types";

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "Nykaa watch",
  targetType: "advertiser",
  targetId: "nykaa",
  targetFingerprint: "fp-nykaa",
  targetLabel: "Nykaa",
  targetCountry: null,
  isActive: true,
  lastScannedAt: null,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z",
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
  landingPageUrl: "https://example.com/glow",
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
    landing_page_url: "https://example.com/glow",
    normalized_headline_hash: "hash-a",
    raw_headline: "Glow serum sale",
    seen_at: "2026-04-18T10:00:00.000Z",
    is_active: 1,
    metadata_json: JSON.stringify({ advertiser: "Nykaa" }),
    ...overrides,
  };
}

function successfulBaseline(overrides: Partial<ProofCaptureRecord> = {}): ProofCaptureRecord {
  return {
    id: "proof-success",
    proofTargetId: "target-1",
    status: "succeeded",
    skipReason: null,
    failureCode: null,
    failureReason: null,
    screenshotArtifactKey: "proofs/success.jpeg",
    htmlArtifactKey: "proofs/success.html",
    extractedFields: {
      rawHeadline: "Glow serum sale",
      normalizedHeadline: "glow serum sale",
      normalizedHeadlineHash: "hash-a",
      ctaText: "Shop now",
      priceText: "Starting at ₹499",
      formPresent: true,
    },
    fieldConfidence: {
      headline: 0.92,
      ctaText: 0.88,
      priceText: 0.87,
    },
    extractionWarnings: [],
    captureMetadata: {},
    renderMode: "mobile",
    deviceProfile: "mobile_default",
    extractorVersion: "lp-signals-v1",
    idempotencyKey: "proof-request:watch-1",
    attemptedAt: "2026-04-01T00:00:00.000Z",
    succeededAt: "2026-04-01T00:00:01.000Z",
    createdAt: "2026-04-01T00:00:01.000Z",
    updatedAt: "2026-04-01T00:00:01.000Z",
    ...overrides,
  };
}

function failedRecentAttempt(): ProofCaptureRecord {
  return {
    ...successfulBaseline({
      id: "proof-failed",
      status: "failed",
      failureCode: "timeout",
      failureReason: "Timed out",
      attemptedAt: "2026-04-18T09:58:00.000Z",
      succeededAt: null,
      screenshotArtifactKey: null,
      htmlArtifactKey: null,
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-18T10:30:00.000Z"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

function installSharedMocks(input: {
  recentEvents?: WatchEventRecord[];
  createdEvents: WatchEventRecord[];
  finishWatchlistRun: ReturnType<typeof vi.fn>;
}) {
  const createEventCandidate = vi.fn().mockResolvedValue("candidate-1");
  const createProofCapture = vi
    .fn()
    .mockResolvedValueOnce("proof-current")
    .mockResolvedValue("proof-current");
  const createWatchEvent = vi.fn().mockImplementation((_env, event) => {
    input.createdEvents.push({
      id: `event-${input.createdEvents.length + 1}`,
      watchlistId: event.watchlistId,
      runId: event.runId,
      eventType: event.eventType,
      status: event.status ?? "confirmed",
      importanceScore: event.importanceScore ?? 0,
      adId: event.adId,
      baselineFromRunId: event.baselineFromRunId,
      candidateId: event.candidateId ?? null,
      proofCaptureId: event.proofCaptureId ?? null,
      title: event.title,
      summary: event.summary,
      metadata: event.metadata ?? {},
      confirmedAt: event.confirmedAt ?? "2026-04-18T10:00:20.000Z",
      suppressedAt: event.suppressedAt ?? null,
      invalidatedAt: event.invalidatedAt ?? null,
      lastEvaluatedAt: event.lastEvaluatedAt ?? "2026-04-18T10:00:20.000Z",
      createdAt: "2026-04-18T10:00:20.000Z",
    });
  });

  vi.doMock("~/lib/analysis.server", () => ({
    buildAnalysisFields: vi.fn(() => []),
  }));
  vi.doMock("~/lib/creative-text.server", () => ({
    captureCreativeText: vi.fn(),
  }));
  vi.doMock("~/lib/landing-pages.server", () => ({
    captureLandingPageSnapshot: vi.fn().mockResolvedValue({
      rawUrl: "https://example.com/glow",
      canonicalUrl: "https://example.com/glow",
      rawHeadline: "Glow serum sale",
      normalizedHeadline: "glow serum sale",
      normalizedHeadlineHash: "hash-a",
      ctaText: "Get offer",
      priceText: "Starting at ₹499",
      formPresent: true,
      captureMethod: "browser_render",
      capturedAt: "2026-04-18T10:00:15.000Z",
      artifactKey: "landing-pages/page.html",
      metadata: {
        htmlArtifactKey: "landing-pages/page.html",
        screenshotArtifactKey: "landing-pages/page.jpeg",
        captureValidated: true,
        screenshotCorroborates: true,
        extractorVersion: "lp-signals-v1",
        extractedFieldConfidence: {
          headline: 0.95,
          ctaText: 0.9,
          priceText: 0.86,
          formPresent: 0.91,
        },
        extractionWarnings: [],
        renderMode: "mobile",
        deviceProfile: "mobile_default",
      },
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
  vi.doMock("~/lib/delivery.server", () => ({
    deliverWatchlistAlerts: vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [{
        status: "sent",
        outcome: "provider_accepted",
        claimedByThisRun: true,
        providerAttemptedByThisRun: true,
        duplicate: false,
        source: "current_claim",
      }],
    }),
    deliverWeeklyDigest: vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    }),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue("starter"),
    PLAN_LIMITS: {
      free: { digests: false, digestCadence: "none" },
      starter: { digests: true, digestCadence: "weekly" },
      agency: { digests: true, digestCadence: "daily_and_weekly" },
    },
  }));
  vi.doMock("~/lib/data.server", () => ({
    addDigestItem: vi.fn(),
		claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
    clearDigestItems: vi.fn(),
		completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
    countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
    countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
    createAdObservation: vi.fn(),
		createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
    createEventCandidate,
    createLandingPageSnapshot: vi.fn(),
    createProofCapture,
    createWatchEvent,
    createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
    finishWatchlistRun: input.finishWatchlistRun,
    getDigestByPeriod: vi.fn().mockResolvedValue(null),
    getDigest: vi.fn().mockResolvedValue(null),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    enqueueDigestScheduleJobs: vi.fn().mockResolvedValue(1),
    exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    listRetryableDigestScheduleJobs: vi.fn().mockResolvedValue([{
      id: "digest-job-user-1",
      userId: "user-1",
      userEmail: "owner@example.com",
      userName: "Owner",
      cadence: "weekly",
      periodStart: "2026-07-06T05:00:00.000Z",
      periodEnd: "2026-07-13T05:00:00.000Z",
      attemptCount: 0,
    }]),
    claimDigestScheduleJob: vi.fn().mockImplementation(
      async (_env: unknown, input: { jobId: string }) => ({
        id: input.jobId,
        userId: "user-1",
        userEmail: "owner@example.com",
        userName: "Owner",
        cadence: "weekly",
        periodStart: "2026-07-06T05:00:00.000Z",
        periodEnd: "2026-07-13T05:00:00.000Z",
        attemptCount: 1,
      }),
    ),
    completeDigestScheduleJob: vi.fn().mockResolvedValue(true),
    failDigestScheduleJob: vi.fn().mockResolvedValue(true),
    getUserDeliveryProfile: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
    }),
    hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
    getSavedQuery: vi.fn(),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
    listActiveWatchlists: vi.fn().mockResolvedValue([watchlist]),
    listEventCandidates: vi.fn().mockResolvedValue([]),
    listObservationsForRun: vi.fn(async (_env: unknown, runId: string) => {
      if (runId === "run-1") {
        return [observation()];
      }
      if (runId === "run-0") {
        return [observation({ watchlist_run_id: "run-0" })];
      }
      return [];
    }),
    listProofCapturesForTarget: vi.fn().mockResolvedValue([
      failedRecentAttempt(),
      successfulBaseline(),
    ]),
    listProofCapturesForTargets: vi.fn(async (_env: unknown, ids: string[]) => {
      const map = new Map<string, ReturnType<typeof successfulBaseline>[]>();
      const captures = [failedRecentAttempt(), successfulBaseline()];
      for (const id of ids) {
        map.set(id, captures);
      }
      return map;
    }),
    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
    listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([successfulBaseline()]),
    listLastSuccessfulProofCapturesForAds: vi.fn(async (_env: unknown, _watchlistId: string, adIds: string[]) => {
      const map = new Map<string, ReturnType<typeof successfulBaseline>[]>();
      for (const id of adIds) {
        map.set(id, [successfulBaseline()]);
      }
      return map;
    }),
    listWatchEvents: vi.fn().mockResolvedValue(input.recentEvents ?? []),
    listWatchEventsForRun: vi.fn().mockImplementation(async () => input.createdEvents),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween: vi.fn().mockImplementation(async () => input.createdEvents),
    listWatchlists: vi.fn().mockResolvedValue([watchlist]),
    logMetaIntegrationStatus: vi.fn(),
    touchWatchlistScanned: vi.fn(),
    upsertAd: vi.fn(),
    upsertDigestDelivery: vi.fn(),
    upsertProofTarget: vi.fn().mockResolvedValue({
      id: "target-1",
      watchlistId: "watch-1",
      adId: "meta-nykaa-1",
      landingPageUrl: "https://example.com/glow",
      canonicalPageIdentity: "example.com/glow",
      proofTargetIdentity: "watch-1:meta-nykaa-1:example.com/glow",
      lastCaptureAttemptAt: "2026-04-18T10:00:15.000Z",
      lastSuccessfulProofAt: "2026-04-01T00:00:01.000Z",
      lastSuccessfulCaptureId: "proof-success",
      createdAt: "2026-04-01T00:00:01.000Z",
      updatedAt: "2026-04-18T10:00:15.000Z",
    }),
  }));
}

describe("proof-first pipeline", () => {
  it("runs detect -> prove -> confirm -> deliver using the last successful proof", async () => {
    const createdEvents: WatchEventRecord[] = [];
    const finishWatchlistRun = vi.fn();

    installSharedMocks({
      createdEvents,
      finishWatchlistRun,
    });

    const { runWatchlistManual, runWeeklyDigests } = await import("~/lib/monitoring.server");
    const { deliverWeeklyDigest } = await import("~/lib/delivery.server");

    await runWatchlistManual(
      { ALLOW_PLATFORM_META_API_FALLBACK: "true", META_AD_LIBRARY_TOKEN: "token" } as never,
      watchlist,
    );

    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]).toEqual(
      expect.objectContaining({
        eventType: "landing_page_cta_changed",
        status: "confirmed",
        proofCaptureId: "proof-current",
      }),
    );
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        status: "succeeded",
        summary: expect.objectContaining({
          candidatesDetected: 1,
          proofsAttempted: 1,
          eventsConfirmed: 1,
          sendsTriggered: 1,
          events: 1,
        }),
      }),
    );

    // Pin weekly periodEnd to match schedule-job fixtures (not wall-clock).
    const result = await runWeeklyDigests(
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
      { periodEnd: "2026-07-13T05:00:00.000Z" },
    );

    expect(result).toBe(1);
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        digestRunId: "digest-1",
        items: [
          expect.objectContaining({
            eventId: createdEvents[0]?.id,
            eventType: "landing_page_cta_changed",
            title: "Landing page CTA changed",
          }),
        ],
      }),
    );
  });

  it("suppresses the same normalized proof diff on a follow-up run", async () => {
    const recentEvents: WatchEventRecord[] = [
      {
        id: "event-existing",
        watchlistId: "watch-1",
        runId: "run-prev",
        eventType: "landing_page_cta_changed",
        status: "confirmed",
        importanceScore: 72,
        adId: "meta-nykaa-1",
        baselineFromRunId: null,
        candidateId: "candidate-prev",
        proofCaptureId: "proof-success",
        title: "Landing page CTA changed",
        summary: "The landing-page call to action changed.",
        metadata: {
          proofTargetIdentity: "watch-1:meta-nykaa-1:example.com/glow",
          diffHash: "landing_page_cta_changed:shop now:get offer",
        },
        confirmedAt: "2026-04-18T09:00:00.000Z",
        suppressedAt: null,
        invalidatedAt: null,
        lastEvaluatedAt: "2026-04-18T09:00:00.000Z",
        createdAt: "2026-04-18T09:00:00.000Z",
      },
    ];
    const createdEvents: WatchEventRecord[] = [];
    const finishWatchlistRun = vi.fn();

    installSharedMocks({
      recentEvents,
      createdEvents,
      finishWatchlistRun,
    });

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await runWatchlistManual(
      { ALLOW_PLATFORM_META_API_FALLBACK: "true", META_AD_LIBRARY_TOKEN: "token" } as never,
      watchlist,
    );

    expect(createdEvents).toEqual([]);
    expect(finishWatchlistRun).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        status: "succeeded",
        summary: expect.objectContaining({
          candidatesDetected: 1,
          proofsAttempted: 1,
          eventsConfirmed: 0,
        }),
      }),
    );
  });
});
