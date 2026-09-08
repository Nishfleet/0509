import { afterEach, describe, expect, it, vi } from "vitest";

import { creativeCaptureSourceFingerprint } from "~/lib/creative-capture-policy";
import type { AdRecord, WatchlistRecord } from "~/lib/types";

const watchlist: WatchlistRecord = {
  id: "watch-1",
  userId: "user-1",
  name: "boAt watch",
  targetType: "advertiser",
  targetId: "boAt",
  targetFingerprint: "fp-boat",
  targetLabel: "boAt",
  targetCountry: null,
  isActive: true,
  lastScannedAt: null,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

const baseAd: AdRecord = {
  metaAdId: "meta-boat-1",
  advertiser: "boAt",
  body: "Bass bhi, battery bhi.",
  previewHeadline: "Bass bhi. Battery bhi.",
  previewSubhead: "Launch pricing",
  hook: "Bass bhi. Battery bhi.",
  offer: "Launch pricing",
  cta: "Buy now",
  format: "image",
  languageLabel: "Hinglish",
  destinationType: "website",
  landingPageUrl: null,
  adSnapshotUrl: "https://cdn.example.com/meta-boat-1.png",
  countries: ["India"],
  platforms: ["Instagram"],
  firstSeenAt: null,
  lastSeenAt: null,
  active: true,
  researchSummary: "Summary",
  source: "meta",
  analysisFields: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runWatchlistManual OCR reuse", () => {
  it.each([
    {
      creativeText: "60 Hours Playback\nOnly ₹999",
      creativeTextMetadata: {
        source: "stored",
      },
      expectedCaptureCalls: 0,
      scenario: "reuses non-empty stored creative text",
    },
    {
      creativeText: "   ",
      creativeTextMetadata: {
        source: "stored",
      },
      expectedCaptureCalls: 1,
      scenario: "recaptures whitespace-only stored creative text",
    },
    {
      creativeText: null,
      creativeTextMetadata: {
        capturedAt: new Date().toISOString(),
        extractionStatus: "unreadable",
        unreadableReasonCode: "ocr_binding_missing",
        creativeSourceFingerprint: "different-source",
      },
      expectedCaptureCalls: 1,
      scenario: "recaptures when recent unreadable metadata belongs to another source",
    },
    {
      creativeText: null,
      creativeTextMetadata: {
        capturedAt: new Date().toISOString(),
        extractionStatus: "unreadable",
        unreadableReasonCode: "ocr_binding_missing",
        creativeSourceFingerprint: creativeCaptureSourceFingerprint(baseAd),
      },
      expectedCaptureCalls: 0,
      scenario: "reuses a recent persisted unreadable OCR result",
    },
    {
      creativeText: null,
      creativeTextMetadata: {
        capturedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
        extractionStatus: "unreadable",
        unreadableReasonCode: "ocr_binding_missing",
        creativeSourceFingerprint: creativeCaptureSourceFingerprint(baseAd),
      },
      expectedCaptureCalls: 1,
      scenario: "recaptures an unreadable OCR result after the cooldown",
    },
    {
      creativeText: null,
      creativeTextMetadata: {
        capturedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        extractionStatus: "unreadable",
        unreadableReasonCode: "ocr_binding_missing",
        creativeSourceFingerprint: creativeCaptureSourceFingerprint(baseAd),
      },
      expectedCaptureCalls: 1,
      scenario: "recaptures when the unreadable timestamp is in the future",
    },
  ])("$scenario", async ({
    creativeText,
    creativeTextMetadata,
    expectedCaptureCalls,
  }) => {
    const env = {
      ALLOW_PLATFORM_META_API_FALLBACK: "true",
      META_AD_LIBRARY_TOKEN: "token",
    };
    const hydratedAd: AdRecord = {
      ...baseAd,
      creativeText,
      creativeTextCaptureMethod: "ad_snapshot_fetch",
      creativeTextMetadata,
    };
    const captureCreativeText = vi.fn().mockResolvedValue({
      text: "Fresh OCR",
      captureMethod: "ad_snapshot_fetch",
      metadata: {
        source: "fresh",
      },
    });
    const hydrateAdsWithPersistedCreatives = vi.fn().mockResolvedValue([hydratedAd]);

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText,
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
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives,
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
    listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
    listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listObservationsForRun: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listWatchEventsForRun: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertProofTarget: vi.fn().mockResolvedValue(null),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
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
        source: "meta",
      }),
    }));

    const { runWatchlistManual } = await import("~/lib/monitoring.server");
    await runWatchlistManual(env as never, watchlist);

    expect(hydrateAdsWithPersistedCreatives).toHaveBeenCalledWith(env, [baseAd]);
    expect(captureCreativeText).toHaveBeenCalledTimes(expectedCaptureCalls);
  });
});
