import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchlistRecord } from "~/lib/types";

const activeWatchlists: WatchlistRecord[] = [
  {
    id: "watch-1",
    userId: "user-1",
    name: "boAt watch",
    targetType: "advertiser",
    targetId: "boat",
    targetFingerprint: "fp-boat",
    targetLabel: "boAt",
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "watch-2",
    userId: "user-2",
    name: "Nykaa watch",
    targetType: "advertiser",
    targetId: "nykaa",
    targetFingerprint: "fp-nykaa",
    targetLabel: "Nykaa",
    isActive: true,
    lastScannedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
];

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runScheduledMonitoring workflow idempotency", () => {
  it("reuses deterministic workflow ids and treats duplicate cron creates as no-ops", async () => {
    const listActiveWatchlists = vi.fn().mockResolvedValue(activeWatchlists);

    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists,
      listObservationsForRun: vi.fn(),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      searchAds: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const seenIds = new Set<string>();
    const workflowCreate = vi.fn(
      async (input?: { id?: string; params?: Record<string, unknown> }) => {
        if (!input?.id) {
          throw new Error("Workflow id is required for scheduled monitoring.");
        }

        if (seenIds.has(input.id)) {
          throw new Error(`Workflow instance ${input.id} already exists.`);
        }

        seenIds.add(input.id);
        return { id: input.id };
      },
    );

    const env = {
      DB: {},
      MONITORING_WORKFLOW: {
        create: workflowCreate,
      },
    };

    const { runScheduledMonitoring } = await import("~/lib/monitoring.server");

    const first = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 5 * * MON",
      scheduledTime: Date.parse("2026-04-20T05:00:00.000Z"),
    });
    const second = await runScheduledMonitoring(env as never, {
      includeDigests: false,
      cron: "0 5 * * MON",
      scheduledTime: Date.parse("2026-04-20T05:00:00.000Z"),
    });

    expect(first).toMatchObject({
      queued: 2,
      duplicates: 0,
      inlineRuns: 0,
      digests: 0,
    });
    expect(second).toMatchObject({
      queued: 0,
      duplicates: 2,
      inlineRuns: 0,
      digests: 0,
    });

    const [firstCreate, secondCreate, duplicateFirstCreate, duplicateSecondCreate] =
      workflowCreate.mock.calls;

    expect(firstCreate?.[0]?.id).toBe(duplicateFirstCreate?.[0]?.id);
    expect(secondCreate?.[0]?.id).toBe(duplicateSecondCreate?.[0]?.id);
    expect(firstCreate?.[0]?.params).toMatchObject({
      watchlistId: "watch-1",
      executionKey: firstCreate?.[0]?.id,
    });
    expect(secondCreate?.[0]?.params).toMatchObject({
      watchlistId: "watch-2",
      executionKey: secondCreate?.[0]?.id,
    });
  });

  it("builds stable proof-capture request keys from the same watch event inputs", async () => {
    vi.doMock("~/lib/analysis.server", () => ({
      buildAnalysisFields: vi.fn(() => []),
    }));
    vi.doMock("~/lib/creative-text.server", () => ({
      captureCreativeText: vi.fn(),
    }));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/meta-api.server", () => ({
      MetaApiError: class MetaApiError extends Error {},
      searchAds: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn(),
      PLAN_LIMITS: {
        free: { digests: false },
        starter: { digests: true },
        agency: { digests: true },
      },
    }));

    const { buildProofCaptureRequestIdempotencyKey } = await import("~/lib/monitoring.server");

    const baseline = buildProofCaptureRequestIdempotencyKey({
      watchlistId: "watch-1",
      adId: "meta-boat-1",
      landingPageUrl: "https://example.com/landing",
      eventType: "landing_page_headline_changed",
    });
    const duplicate = buildProofCaptureRequestIdempotencyKey({
      watchlistId: "watch-1",
      adId: "meta-boat-1",
      landingPageUrl: "https://example.com/landing",
      eventType: "landing_page_headline_changed",
    });
    const changed = buildProofCaptureRequestIdempotencyKey({
      watchlistId: "watch-1",
      adId: "meta-boat-2",
      landingPageUrl: "https://example.com/landing",
      eventType: "landing_page_headline_changed",
    });

    expect(duplicate).toBe(baseline);
    expect(changed).not.toBe(baseline);
  });
});
