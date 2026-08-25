import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdRecord, ProofCaptureRecord, WatchlistRecord } from "~/lib/types";

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

const freshSnapshot = {
  rawUrl: "https://example.com/glow",
  canonicalUrl: "https://example.com/glow",
  rawHeadline: "Glow serum sale",
  normalizedHeadline: "glow serum sale",
  normalizedHeadlineHash: "hash-a",
  ctaText: "Get offer",
  priceText: "Starting at ₹499",
  formPresent: true,
  captureMethod: "browser_render" as const,
  capturedAt: "2026-04-18T10:00:15.000Z",
  artifactKey: "landing-pages/page.html",
  metadata: {
    htmlArtifactKey: "landing-pages/page.html",
    screenshotArtifactKey: "landing-pages/page.jpeg",
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
  return successfulBaseline({
    id: "proof-failed",
    status: "failed",
    failureCode: "timeout",
    failureReason: "Timed out",
    attemptedAt: "2026-04-18T09:58:00.000Z",
    succeededAt: null,
    screenshotArtifactKey: null,
    htmlArtifactKey: null,
  });
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

// The idempotency key the monitoring run builds for this watchlist/ad/url,
// including the run id. A pre-existing succeeded proof_capture with this key
// is treated as a replay (no fresh capture, no new snapshot row).
const REPLAY_PROOF_REQUEST_KEY =
  "proof-request:watch-1:landing-page-headline-changed:meta-nykaa-1:https-example-com-glow:run-1";

function installMocks(options: {
  createLandingPageSnapshot: ReturnType<typeof vi.fn>;
  captureLandingPageSnapshot: ReturnType<typeof vi.fn>;
  replayedProofCapture?: ProofCaptureRecord;
}) {
  const createEventCandidate = vi.fn().mockResolvedValue("candidate-1");
  const createProofCapture = vi.fn().mockResolvedValue("proof-current");
  const createWatchEvent = vi.fn().mockResolvedValue("event-1");

  vi.doMock("~/lib/analysis.server", () => ({
    buildAnalysisFields: vi.fn(() => []),
  }));
  vi.doMock("~/lib/creative-text.server", () => ({
    captureCreativeText: vi.fn(),
  }));
  vi.doMock("~/lib/landing-pages.server", () => ({
    captureLandingPageSnapshot: options.captureLandingPageSnapshot,
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
      details: [
        {
          status: "sent",
          outcome: "provider_accepted",
          claimedByThisRun: true,
          providerAttemptedByThisRun: true,
          duplicate: false,
          source: "current_claim",
        },
      ],
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
    clearDigestItem: vi.fn(),
    completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
    countProofCapturesForWatchlistSince: vi.fn().mockResolvedValue(0),
    countProofCapturesForWorkspaceSince: vi.fn().mockResolvedValue(0),
    createAdObservation: vi.fn(),
    createDigestRun: vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true }),
    createEventCandidate,
    createLandingPageSnapshot: options.createLandingPageSnapshot,
    createProofCapture,
    createWatchEvent,
    createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
    finishWatchlistRun: vi.fn(),
    getDigestByPeriod: vi.fn().mockResolvedValue(null),
    getDigest: vi.fn().mockResolvedValue(null),
    getUserDeliveryProfile: vi.fn().mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
    }),
    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
    hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
    getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
    getSavedQuery: vi.fn(),
    getWatchlist: vi.fn().mockResolvedValue(watchlist),
    hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
    listActiveWatchlists: vi.fn().mockResolvedValue([watchlist]),
    listObservationsForRun: vi.fn(async (_env: unknown, runId: string) => {
      if (runId === "run-1") return [observation()];
      if (runId === "run-0") return [observation({ watchlist_run_id: "run-0" })];
      return [];
    }),
    listProofCapturesForTarget: vi.fn().mockResolvedValue(
      options.replayedProofCapture
        ? [options.replayedProofCapture, failedRecentAttempt()]
        : [failedRecentAttempt(), successfulBaseline()],
    ),
    listProofCapturesForTargets: vi.fn(async (_env: unknown, ids: string[]) => {
      const map = new Map<string, ProofCaptureRecord[]>();
      const captures = options.replayedProofCapture
        ? [options.replayedProofCapture, failedRecentAttempt()]
        : [failedRecentAttempt(), successfulBaseline()];
      for (const id of ids) map.set(id, captures);
      return map;
    }),
    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
    listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([successfulBaseline()]),
    listLastSuccessfulProofCapturesForAds: vi.fn(async (_env: unknown, _watchlistId: string, adIds: string[]) => {
      const map = new Map<string, ProofCaptureRecord[]>();
      for (const id of adIds) map.set(id, [successfulBaseline()]);
      return map;
    }),
    listWatchEvents: vi.fn().mockResolvedValue([]),
    listWatchEventsForRun: vi.fn().mockResolvedValue([]),
    listAdsByIds: vi.fn().mockResolvedValue([]),
    listWatchEventsBetween: vi.fn().mockResolvedValue([]),
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

describe("landing_page_snapshot persistence on monitoring capture", () => {
  it("persists a fresh capture as a versioned landing_page_snapshot row with all fields", async () => {
    const createLandingPageSnapshot = vi.fn().mockResolvedValue("snapshot-1");
    const captureLandingPageSnapshot = vi.fn().mockResolvedValue(freshSnapshot);

    installMocks({ createLandingPageSnapshot, captureLandingPageSnapshot });

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await runWatchlistManual(
      { ALLOW_PLATFORM_META_API_FALLBACK: "true", META_AD_LIBRARY_TOKEN: "token" } as never,
      watchlist,
    );

    expect(captureLandingPageSnapshot).toHaveBeenCalled();
    expect(createLandingPageSnapshot).toHaveBeenCalledTimes(1);
    expect(createLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        canonicalUrl: "https://example.com/glow",
        rawHeadline: "Glow serum sale",
        normalizedHeadline: "glow serum sale",
        normalizedHeadlineHash: "hash-a",
        ctaText: "Get offer",
        priceText: "Starting at ₹499",
        formPresent: true,
        artifactKey: "landing-pages/page.html",
      }),
    );
  });

  it("does not append a duplicate snapshot row on a replayed (already-succeeded) capture", async () => {
    const createLandingPageSnapshot = vi.fn().mockResolvedValue("snapshot-1");
    const captureLandingPageSnapshot = vi.fn();

    installMocks({
      createLandingPageSnapshot,
      captureLandingPageSnapshot,
      replayedProofCapture: successfulBaseline({
        id: "proof-replay",
        idempotencyKey: REPLAY_PROOF_REQUEST_KEY,
        attemptedAt: "2026-04-18T10:00:00.000Z",
        succeededAt: "2026-04-18T10:00:01.000Z",
      }),
    });

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    await runWatchlistManual(
      { ALLOW_PLATFORM_META_API_FALLBACK: "true", META_AD_LIBRARY_TOKEN: "token" } as never,
      watchlist,
    );

    expect(captureLandingPageSnapshot).not.toHaveBeenCalled();
    expect(createLandingPageSnapshot).not.toHaveBeenCalled();
  });
});
