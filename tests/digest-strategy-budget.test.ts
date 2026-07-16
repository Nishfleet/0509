import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GOOD_PARAGRAPH =
	"boAt refreshed its landing page offer while the remaining monitored competitors stayed stable. " +
	"The weekly evidence therefore concentrates on that one verified change.";

const users = Array.from({ length: 4 }, (_, index) => ({
	id: `user-${index + 1}`,
	email: `owner-${index + 1}@example.com`,
	name: `Owner ${index + 1}`,
}));

function confirmedEvent(watchlistId: string) {
	return {
		id: `event-${watchlistId}`,
		watchlistId,
		adId: null,
		eventType: "landing_page_offer_changed",
		status: "confirmed",
		importanceScore: 79,
		proofCaptureId: `proof-${watchlistId}`,
		title: "Landing page offer changed",
		summary: "Offer changed on the landing page.",
		confirmedAt: "2026-07-12T05:00:00.000Z",
		createdAt: "2026-07-12T05:00:00.000Z",
		metadata: {},
	};
}

function dataServerMock() {
	return {
		claimDigestStrategyGenerationLease: vi.fn().mockResolvedValue(true),
		completeDigestStrategyGeneration: vi.fn().mockResolvedValue(true),
		createAdObservation: vi.fn(),
		createDigestRun: vi.fn().mockImplementation(
			async (_env: unknown, userId: string) => ({
				digestRunId: `digest-${userId}`,
				created: true,
			}),
		),
		createEventCandidate: vi.fn(),
		createProofCapture: vi.fn(),
		createWatchEvent: vi.fn(),
		createWatchlistRun: vi.fn(),
		countProofCapturesForWatchlistSince: vi.fn(),
		countProofCapturesForWorkspaceSince: vi.fn(),
		finishWatchlistRun: vi.fn(),
		getDigest: vi.fn().mockResolvedValue(null),
		getDigestByPeriod: vi.fn().mockResolvedValue(null),
		getSuccessfulRunStatsForUserBetween: vi.fn().mockResolvedValue({
			runs: 0,
			watchlistsChecked: 0,
			adsSeen: 0,
		}),
		getUserDeliveryProfile: vi.fn(),
		getRecentSuccessfulRuns: vi.fn(),
		getSavedQuery: vi.fn(),
		getWatchlist: vi.fn(),
		hasInFlightWatchlistRun: vi.fn().mockResolvedValue(false),
		hydrateAdsWithPersistedCreatives: vi.fn(),
		listActiveWatchlists: vi.fn().mockResolvedValue([]),
		listAdsByIds: vi.fn().mockResolvedValue([]),
		listLastSuccessfulProofCapturesForAds: vi.fn().mockResolvedValue(new Map()),
		listObservationsForRun: vi.fn(),
		listProofCapturesForTarget: vi.fn(),
		listProofCapturesForTargets: vi.fn().mockResolvedValue(new Map()),
		listRecentWorkspaceProofCaptures: vi.fn(),
		listRetryableDigestRuns: vi.fn().mockResolvedValue([]),
		listRetryableInstantAttempts: vi.fn().mockResolvedValue([]),
		listWatchEvents: vi.fn(),
		listWatchEventsBetween: vi.fn().mockImplementation(
			async (_env: unknown, watchlistId: string) => [confirmedEvent(watchlistId)],
		),
		listWatchEventsByIds: vi.fn(),
		listWatchlists: vi.fn().mockImplementation(
			async (_env: unknown, userId: string) => [
				{ id: `watch-${userId}`, name: `Watch ${userId}` },
			],
		),
		logMetaIntegrationStatus: vi.fn(),
		recordWatchlistCapacitySkip: vi.fn(),
		touchWatchlistScanned: vi.fn(),
		upsertAd: vi.fn(),
		upsertProofTarget: vi.fn(),
	};
}

function planServerMock() {
	return {
		getUserPlan: vi.fn().mockResolvedValue("starter"),
		PLAN_LIMITS: {
			free: { digests: false, digestCadence: "none" },
			scout: { digests: true, digestCadence: "weekly" },
			starter: { digests: true, digestCadence: "weekly" },
			agency: { digests: true, digestCadence: "daily_and_weekly" },
		},
	};
}

function envWith(aiRun: ReturnType<typeof vi.fn>) {
	return {
		AI: { run: aiRun },
		DB: {
			prepare() {
				return {
					async all<T>() {
						return { results: users as T[] };
					},
				};
			},
		},
	} as never;
}

beforeEach(() => {
	vi.resetModules();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

describe("scheduled digest strategy budget", () => {
	it("bounds optional AI work while delivering every deterministic digest", async () => {
		let now = Date.parse("2026-07-13T05:00:00.000Z");
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const data = dataServerMock();
		const deliverWeeklyDigest = vi
			.fn()
			.mockResolvedValue({ attempts: 1, channels: ["email"] });
		const aiRun = vi.fn().mockImplementation(async () => {
			now += 30_000;
			return GOOD_PARAGRAPH;
		});

		vi.doMock("~/lib/auth.server", () => ({}));
		vi.doMock("~/lib/data.server", () => data);
		vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
		vi.doMock("~/lib/plan.server", () => planServerMock());

		const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
		const result = await runScheduledMonitoring(envWith(aiRun), {
			includeScans: false,
			includeDigests: true,
			digestCadence: "weekly",
			scheduledTime: Date.parse("2026-07-13T05:00:00.000Z"),
		});

		expect(result.digests).toBe(4);
		expect(deliverWeeklyDigest).toHaveBeenCalledTimes(4);
		expect(data.completeDigestStrategyGeneration).toHaveBeenCalledTimes(4);
		expect(aiRun).toHaveBeenCalledTimes(2);
		expect(
			data.completeDigestStrategyGeneration.mock.calls.slice(2).map((call) => call[2]),
		).toEqual([
			expect.objectContaining({
				summary: expect.not.objectContaining({ strategyParagraph: expect.anything() }),
			}),
			expect.objectContaining({
				summary: expect.not.objectContaining({ strategyParagraph: expect.anything() }),
			}),
		]);
	});
});
