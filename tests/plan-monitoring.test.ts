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
  targetCountry: null,
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

function alertDetail(
  outcome:
    | "provider_accepted"
    | "definitive_terminal_failure"
    | "pending_provider_unknown"
    | "quiet_deferral"
    | "intentional_dedupe" = "provider_accepted",
  claimedByThisRun = true,
) {
  return {
    status: outcome === "provider_accepted" ? "sent" : "failed",
    outcome,
    claimedByThisRun,
    providerAttemptedByThisRun:
      claimedByThisRun &&
      outcome !== "quiet_deferral" &&
      outcome !== "intentional_dedupe",
    duplicate: !claimedByThisRun,
    source: claimedByThisRun ? "current_claim" : "durable_attempt",
  };
}

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

function digestScheduleDataMocks() {
  let jobs: Array<{
    id: string;
    userId: string;
    userEmail: string;
    userName: string;
    cadence: "daily" | "weekly";
    periodStart: string;
    periodEnd: string;
    attemptCount: number;
  }> = [];

  return {
    enqueueDigestScheduleJobs: vi.fn().mockImplementation(
      async (
        _env: unknown,
        input: { cadence: "daily" | "weekly"; periodStart: string; periodEnd: string },
      ) => {
        jobs = [{
          id: `digest-job-user-1:${input.cadence}:${input.periodEnd}`,
          userId: "user-1",
          userEmail: "owner@example.com",
          userName: "Owner",
          cadence: input.cadence,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          attemptCount: 0,
        }];
        return 1;
      },
    ),
    exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
    listRetryableDigestScheduleJobs: vi.fn().mockImplementation(async () => jobs),
    claimDigestScheduleJob: vi.fn().mockImplementation(
      async (_env: unknown, input: { jobId: string }) =>
        jobs.find((job) => job.id === input.jobId) ?? null,
    ),
    completeDigestScheduleJob: vi.fn().mockImplementation(async () => {
      jobs = [];
      return true;
    }),
    failDigestScheduleJob: vi.fn().mockResolvedValue(true),
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
  it("generates the weekly digest for free-plan users (free weekly watch)", async () => {
    const listWatchlists = vi.fn().mockResolvedValue([
      {
        id: "watch-1",
        name: "boAt watch",
      },
    ]);
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    });
    vi.doMock("~/lib/delivery.server", () => ({
      deliverWeeklyDigest,
      deliverScanTroubleNotice: vi.fn(),
    }));

    vi.doMock("~/lib/data.server", () => ({
      addDigestItem: vi.fn(),
      clearDigestItems: vi.fn(),
      createAdObservation: vi.fn(),
      createDigestRun: vi
        .fn()
        .mockResolvedValue({ digestRunId: "digest-free-1", created: true }),
      createEventCandidate: vi.fn(),
      createLandingPageSnapshot: vi.fn(),
      createProofCapture: vi.fn(),
      createWatchEvent: vi.fn(),
      createWatchlistRun: vi.fn(),
      countProofCapturesForWatchlistSince: vi.fn(),
      countProofCapturesForWorkspaceSince: vi.fn(),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn().mockResolvedValue(null),
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getSuccessfulRunStatsForUserBetween: vi.fn().mockResolvedValue({
        runs: 2,
        watchlistsChecked: 1,
        adsSeen: 5,
      }),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn(),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn(),
      listSuccessfulProofCapturesForAd: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEvents: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listRecentProofCapturesForWatchlist: vi.fn().mockResolvedValue([]),
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
        free: { digests: true, digestCadence: "weekly" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");

    // Pin weekly periodEnd (Monday 05:00 UTC) so digest windows are not wall-clock-dependent.
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
      } as never,
      { periodEnd: "2026-07-13T05:00:00.000Z" },
    );

    // Free now receives the weekly digest (heartbeat when the period is
    // quiet) — the email itself carries the upgrade line, covered in
    // tests/free-weekly-watch.test.ts.
    expect(result).toBe(1);
    expect(listWatchlists).toHaveBeenCalled();
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        cadence: "weekly",
        heartbeat: expect.objectContaining({ runs: 2 }),
      }),
    );
    vi.doUnmock("~/lib/delivery.server");
  });

  it("delegates Scout digest delivery to the delivery module after building the digest run", async () => {
    const addDigestItem = vi.fn();
		const createDigestRun = vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true });
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn(),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn(),
      listSuccessfulProofCapturesForAd: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEvents: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      getUserPlan: vi.fn().mockResolvedValue("scout"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        scout: { digests: true, digestCadence: "weekly" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");

    // Pin weekly periodEnd (Monday 05:00 UTC) so digest windows are not wall-clock-dependent.
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
      } as never,
      { periodEnd: "2026-07-13T05:00:00.000Z" },
    );

    expect(result).toBe(1);
    expect(createDigestRun).toHaveBeenCalled();
		expect(createDigestRun).toHaveBeenCalledWith(
      expect.anything(),
			"user-1",
			expect.any(String),
			expect.any(String),
			expect.objectContaining({ totalEvents: 1 }),
      expect.objectContaining({
				returnClaim: true,
				items: [
					expect.objectContaining({
						watchlistId: "watch-1",
						eventType: "landing_page_offer_changed",
					}),
				],
      }),
    );
		expect(addDigestItem).not.toHaveBeenCalled();
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

  it("skips daily digest generation for Scout users", async () => {
    const listWatchlists = vi.fn();

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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn(),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn(),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn(),
      listSuccessfulProofCapturesForAd: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEvents: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists,
      logMetaIntegrationStatus: vi.fn(),
      touchWatchlistScanned: vi.fn(),
      upsertProofTarget: vi.fn(),
      upsertAd: vi.fn(),
      upsertDigestDelivery: vi.fn(),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("scout"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        scout: { digests: true, digestCadence: "weekly" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const { runDailyDigests } = await import("~/lib/monitoring.server");

    // Pin to a non-Monday so the WP-22 Monday daily-skip cannot mask plan gating.
    const result = await runDailyDigests(
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
      { periodEnd: "2026-07-15T04:00:00.000Z" },
    );

    expect(result).toBe(0);
    expect(listWatchlists).not.toHaveBeenCalled();
  });

  it("passes the scheduled monitoring timestamp into weekly digest generation", async () => {
		const createDigestRun = vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true });
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
			claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
      clearDigestItems: vi.fn(),
			completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn(),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn().mockResolvedValue([]),
      listProofCapturesForTarget: vi.fn(),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn(),
      listSuccessfulProofCapturesForAd: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEvents: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      deliverWatchlistAlerts: vi.fn().mockResolvedValue({
        attempts: 0,
        channels: [],
        details: [],
      }),
      deliverWeeklyDigest,
    }));
    vi.doMock("~/lib/landing-pages.server", () => ({
      captureLandingPageSnapshot: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
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
		const createDigestRun = vi.fn().mockResolvedValue({ digestRunId: "digest-1", created: true });
    const deliverWeeklyDigest = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
    });

    vi.doMock("~/lib/auth.server", () => ({}));
    vi.doMock("~/lib/data.server", () => ({
      addDigestItem,
			claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
      clearDigestItems: vi.fn(),
			completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn(),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn(),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn(),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn(),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn(),
      listSuccessfulProofCapturesForAd: vi.fn(),
      listObservationsForRun: vi.fn(),
      listWatchEvents: vi.fn(),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const { runWeeklyDigests } = await import("~/lib/monitoring.server");

    // Pin weekly periodEnd (Monday 05:00 UTC) so digest windows are not wall-clock-dependent.
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
    expect(createDigestRun).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        totalEvents: 2,
      }),
			expect.objectContaining({
				returnClaim: true,
				items: [
					expect.objectContaining({
						title: "Possible CTA change",
						metadata: expect.objectContaining({
							eventId: "event-provisional-strong",
							eventStatus: "proof_pending",
							priorityBand: "High priority",
							priorityScore: 90,
							sourceStatus: "scan_backed",
						}),
					}),
					expect.objectContaining({
						title: "Landing page offer changed",
						metadata: expect.objectContaining({
							eventId: "event-confirmed",
							eventStatus: "confirmed",
							priorityBand: "Medium priority",
							priorityScore: 72,
							sourceStatus: "scan_backed",
						}),
					}),
				],
			}),
    );
		expect(addDigestItem).not.toHaveBeenCalled();
    expect(deliverWeeklyDigest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        items: [
		  expect.objectContaining({ eventId: "event-provisional-strong" }),
		  expect.objectContaining({ eventId: "event-confirmed" }),
        ],
      }),
    );
  });
});

describe("runWatchlistManual cheap scan path", () => {
  it("stores scan-side observations and only lets proof policy decide later capture", async () => {
    const createAdObservation = vi.fn();
    const createLandingPageSnapshot = vi.fn();
    const createProofCapture = vi.fn();
    const createWatchEvent = vi.fn();
    const captureLandingPageSnapshot = vi.fn(
      async (
        _env: unknown,
        _url: string,
        options: {
          onFailure?: (detail: {
            reasonCode: string;
            metadata: Record<string, unknown>;
          }) => void;
        },
      ) => {
        options.onFailure?.({
          reasonCode: "landing_blocked",
          metadata: { fetchStatus: 403 },
        });
        return null;
      },
    );
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
      createProofCapture,
      createWatchEvent,
      createWatchlistRun: vi.fn().mockResolvedValue("run-1"),
      finishWatchlistRun: vi.fn(),
      getDigestByPeriod: vi.fn(),
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listObservationsForRun,
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listWatchEventsForRun: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
        details: [],
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
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
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
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "failed",
        failureCode: "landing_blocked",
        captureMetadata: {
          fetchStatus: 403,
          unreadableReasonCode: "landing_blocked",
        },
      }),
    );
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
        captureValidated: true,
        screenshotCorroborates: true,
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
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
        {
          id: "proof-prefix-collision",
          proofTargetId: "target-1",
          status: "failed",
          skipReason: null,
          failureCode: "proof_capture_failed",
          failureReason: "Landing page proof capture failed.",
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
          idempotencyKey:
            "proof-request:watch-1:landing-page-headline-changed:meta-nykaa-1:https-example-com-new-url-extra:run-0",
          attemptedAt: new Date().toISOString(),
          succeededAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      listProofCapturesForTargets: vi.fn(async (_env: unknown, ids: string[]) => {
        const captures = [
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
          {
            id: "proof-prefix-collision",
            proofTargetId: "target-1",
            status: "failed",
            skipReason: null,
            failureCode: "proof_capture_failed",
            failureReason: "Landing page proof capture failed.",
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
            idempotencyKey:
              "proof-request:watch-1:landing-page-headline-changed:meta-nykaa-1:https-example-com-new-url-extra:run-0",
            attemptedAt: new Date().toISOString(),
            succeededAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
        const map = new Map<string, typeof captures>();
        for (const id of ids) {
          map.set(id, captures);
        }
        return map;
      }),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listWatchEventsForRun: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
        details: [],
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
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
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
      expect.objectContaining({ onFailure: expect.any(Function) }),
    );
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        status: "succeeded",
        proofTargetId: "target-1",
        idempotencyKey:
          "proof-request:watch-1:landing-page-headline-changed:meta-nykaa-1:https-example-com-new-url:run-1",
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
    const evidenceUsageStorageError = new Error(
      "D1_ERROR: no such table: evidence_usage_period: SQLITE_ERROR",
    );
    const getEvidenceUsageSummary = vi.fn().mockRejectedValue(evidenceUsageStorageError);
    const tryReserveEvidenceForProofCapture = vi.fn().mockResolvedValue(null);
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [alertDetail()],
    });
    const websiteWatchlist: WatchlistRecord = {
      ...watchlist,
      targetId: "https://competitor.example/onboarding",
      targetFingerprint: "fp-competitor-website",
      targetLabel: "Competitor",
      targetCountry: null,
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
        captureValidated: true,
        screenshotCorroborates: true,
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
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
        {
          id: "proof-direct-prefix-collision",
          proofTargetId: "target-direct-1",
          status: "failed",
          skipReason: null,
          failureCode: "direct_website_proof_capture_failed",
          failureReason: "Direct website proof capture failed.",
          screenshotArtifactKey: null,
          htmlArtifactKey: null,
          extractedFields: {},
          fieldConfidence: {},
          extractionWarnings: [],
          captureMetadata: {},
          renderMode: "mobile",
          deviceProfile: "mobile_default",
          extractorVersion: "lp-signals-v1",
          idempotencyKey:
            "proof-request:watch-1:landing-page-offer-changed:none:https-competitor-example-onboarding-extra:run-0",
          attemptedAt: new Date().toISOString(),
          succeededAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listWatchEventsForRun: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
    vi.doMock("~/lib/evidence-usage.server", () => ({
      getEvidenceUsageSummary,
      isEvidenceUsageStorageUnavailableError: (message: string) =>
        /evidence_usage|evidence_top_up|no such table|D1 binding/i.test(message),
      tryFinalizeEvidenceForProofCapture: vi.fn(),
      tryReserveEvidenceForProofCapture,
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    const env = {
      ALLOW_PLATFORM_META_API_FALLBACK: "true",
      META_AD_LIBRARY_TOKEN: "token",
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue({ results: [{ total: 0 }] }),
          })),
        })),
      },
    };
    const result = await runWatchlistManual(
      env as never,
      websiteWatchlist,
    );

    expect(result.events).toBeGreaterThan(0);
    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      "https://competitor.example/onboarding",
      expect.objectContaining({ preferRendered: true, requireScreenshot: true }),
    );
    expect(createProofCapture).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        status: "succeeded",
        proofTargetId: "target-direct-1",
        idempotencyKey:
          "proof-request:watch-1:landing-page-offer-changed:none:https-competitor-example-onboarding:run-1",
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
    expect(getEvidenceUsageSummary).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      "user-1",
    );
    expect(tryReserveEvidenceForProofCapture).toHaveBeenCalledWith(
      expect.objectContaining({ META_AD_LIBRARY_TOKEN: "token" }),
      expect.objectContaining({
        workspaceUserId: "user-1",
        proofTargetId: "target-direct-1",
        source: "monitoring.direct_website",
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

  it.each([
    ["failed", true],
    ["pending", true],
    ["failed", false],
    ["pending", false],
  ] as const)(
    "keeps the run failed when direct website proof succeeds but alert delivery is %s (current claim: %s)",
    async (alertStatus, claimedByThisRun) => {
    class MockCommercialDiscoveryError extends Error {
      failureClass = "browser_launch_failed" as const;
    }

    const createEventCandidate = vi.fn().mockResolvedValue("candidate-direct-1");
    const createProofCapture = vi.fn().mockResolvedValue("proof-direct-1");
    const createWatchEvent = vi.fn().mockResolvedValue("event-direct-1");
    const finishWatchlistRun = vi.fn();
    const logMetaIntegrationStatus = vi.fn();
    const deliverWatchlistAlerts = vi.fn().mockResolvedValue({
      attempts: 1,
      channels: ["email"],
      details: [
        alertDetail(
          alertStatus === "failed"
            ? "definitive_terminal_failure"
            : "pending_provider_unknown",
          claimedByThisRun,
        ),
      ],
    });
    const websiteWatchlist: WatchlistRecord = {
      ...watchlist,
      targetId: "https://competitor.example/onboarding",
      targetFingerprint: "fp-competitor-website",
      targetLabel: "Competitor",
      targetCountry: null,
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
        captureValidated: true,
        screenshotCorroborates: true,
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
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
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
      listWatchEventsBetween: vi.fn(),
      listWatchlists: vi.fn(),
      logMetaIntegrationStatus,
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
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const { runWatchlistManual } = await import("~/lib/monitoring.server");

    const result = runWatchlistManual({} as never, websiteWatchlist);
    const expectedErrorCode = alertStatus === "failed"
      ? "alert_delivery_failed"
      : "alert_delivery_pending_provider_unknown";
    const expectedMessage = alertStatus === "failed"
      ? "1 customer alert delivery outcome definitively failed."
      : "1 customer alert delivery outcome is pending provider confirmation.";

    await expect(result).rejects.toThrow(expectedMessage);
    expect(captureLandingPageSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "https://competitor.example/onboarding",
      expect.objectContaining({ preferRendered: true, requireScreenshot: true }),
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
        status: "failed",
        errorCode: expectedErrorCode,
        summary: expect.objectContaining({
          scanStatus: "degraded",
          scanErrorCode: "browser_launch_failed",
          sendsTriggered: 0,
          sendAttempts: claimedByThisRun ? 1 : 0,
          sendFailures: claimedByThisRun && alertStatus === "failed" ? 1 : 0,
          events: expect.any(Number),
        }),
      }),
    );
    expect(logMetaIntegrationStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "degraded",
        summary:
          "Commercial discovery failed; direct website evidence completed, but customer alert delivery did not reach a confirmed successful outcome.",
        metadata: expect.objectContaining({
          alertDeliveryAttempts: claimedByThisRun ? 1 : 0,
          alertDeliveryAccepted: 0,
          alertDeliveryFailures: claimedByThisRun && alertStatus === "failed" ? 1 : 0,
          alertDeliveryErrorCode: expectedErrorCode,
        }),
      }),
    );
    expect(deliverWatchlistAlerts).toHaveBeenCalled();
    },
  );

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
	    targetCountry: null,
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
	    getDigest: vi.fn().mockResolvedValue(null),
	    listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
	    ...digestScheduleDataMocks(),
	    getUserDeliveryProfile: vi.fn().mockResolvedValue({
	      id: "user-1",
	      email: "owner@example.com",
	      name: "Owner",
	    }),
	    hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
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
	    listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
	    listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
	    listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
	    listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
	    listWatchEvents: vi.fn().mockResolvedValue([]),
	    listAdsByIds: vi.fn().mockResolvedValue([]),
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
	    getUserPlan: vi.fn().mockResolvedValue("starter"),
	    PLAN_LIMITS: {
	      free: { digests: false, digestCadence: "none" },
	      starter: { digests: true, digestCadence: "weekly" },
	      agency: { digests: true, digestCadence: "daily_and_weekly" },
	    },
	  }));

	  const { runWatchlist } = await import("~/lib/monitoring.server");

	  const result = await runWatchlist(
	    {} as never,
	    websiteWatchlist,
	    "manual",
	    () => Promise.reject(new MockCommercialDiscoveryError("Browser discovery unavailable")),
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
		      summary: "Commercial discovery failed and direct website evidence did not complete.",
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
      targetCountry: null,
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([]),
      listActiveWatchlists: vi.fn(),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listObservationsForRun: vi.fn().mockResolvedValue([]),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
      },
    }));

    const { runWatchlist } = await import("~/lib/monitoring.server");

    await runWatchlist(
      {} as never,
      directWatchlist,
      "manual",
      () => Promise.resolve({ ads: [], pagesScanned: 0, source: "meta_library_browser" } as never),
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
      targetCountry: null,
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
        captureValidated: true,
        screenshotCorroborates: true,
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([]),
      listActiveWatchlists: vi.fn(),
      listEventCandidates: vi.fn().mockResolvedValue([]),
      listObservationsForRun: vi.fn().mockResolvedValue([]),
      listProofCapturesForTarget,
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
      listRecentWorkspaceProofCaptures: vi.fn().mockResolvedValue([]),
      listSuccessfulProofCapturesForAd: vi.fn().mockResolvedValue([]),
      listWatchEvents: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
        details: [],
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
      details: [alertDetail()],
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
      getDigest: vi.fn().mockResolvedValue(null),
      listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
      ...digestScheduleDataMocks(),
      getUserDeliveryProfile: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        name: "Owner",
      }),
      hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
      getRecentSuccessfulRuns: vi.fn().mockResolvedValue([{ id: "run-0" }]),
      getSavedQuery: vi.fn(),
      getWatchlist: vi.fn(),
      hydrateAdsWithPersistedCreatives: vi.fn().mockResolvedValue([baseAd]),
      listActiveWatchlists: vi.fn(),
      listProofCapturesForTarget: vi.fn().mockResolvedValue([]),
      listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
      listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
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
      listWatchEventsForRun: vi.fn().mockResolvedValue([]),
      listAdsByIds: vi.fn().mockResolvedValue([]),
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
      getUserPlan: vi.fn().mockResolvedValue("starter"),
      PLAN_LIMITS: {
        free: { digests: false, digestCadence: "none" },
        starter: { digests: true, digestCadence: "weekly" },
        agency: { digests: true, digestCadence: "daily_and_weekly" },
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
