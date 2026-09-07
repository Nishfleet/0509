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
	const digestJobs = users.map((user) => ({
		id: `digest-job-${user.id}`,
		userId: user.id,
		userEmail: user.email,
		userName: user.name,
		cadence: "weekly" as const,
		periodStart: "2026-07-06T05:00:00.000Z",
		periodEnd: "2026-07-13T05:00:00.000Z",
		attemptCount: 0,
	}));
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
		claimDigestScheduleJob: vi.fn().mockImplementation(
			async (_env: unknown, input: { jobId: string }) =>
				digestJobs.find((job) => job.id === input.jobId) ?? null,
		),
		completeDigestScheduleJob: vi.fn().mockResolvedValue(true),
		enqueueDigestScheduleJobs: vi.fn().mockResolvedValue(digestJobs.length),
		exhaustStaleMaxAttemptDigestScheduleJobs: vi.fn().mockResolvedValue(0),
		failDigestScheduleJob: vi.fn().mockResolvedValue(true),
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
		listRetryableDigestScheduleJobs: vi.fn().mockResolvedValue(digestJobs),
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

	it("persists the user queue and stops starting jobs after the outer deadline", async () => {
		let now = Date.parse("2026-07-13T05:00:00.000Z");
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const data = dataServerMock();
		const deliverWeeklyDigest = vi.fn().mockImplementation(async () => {
			now += 13 * 60 * 1000;
			return { attempts: 1, channels: ["email"] };
		});

		vi.doMock("~/lib/auth.server", () => ({}));
		vi.doMock("~/lib/data.server", () => data);
		vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
		vi.doMock("~/lib/plan.server", () => planServerMock());

		const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
		const result = await runScheduledMonitoring(envWith(vi.fn()), {
			includeScans: false,
			includeDigests: true,
			digestCadence: "weekly",
			scheduledTime: Date.parse("2026-07-13T05:00:00.000Z"),
		});

		expect(result.digests).toBe(1);
		expect(data.enqueueDigestScheduleJobs).toHaveBeenCalledTimes(1);
		expect(data.completeDigestScheduleJob).toHaveBeenCalledTimes(1);
		expect(data.claimDigestScheduleJob).toHaveBeenCalledTimes(1);
		expect(deliverWeeklyDigest).toHaveBeenCalledTimes(1);
	});

	it("surfaces a failed customer digest while continuing the remaining jobs", async () => {
		const data = dataServerMock();
		const deliverWeeklyDigest = vi.fn()
			.mockRejectedValueOnce(new Error("provider unavailable"))
			.mockResolvedValue({ attempts: 1, channels: ["email"] });

		vi.doMock("~/lib/auth.server", () => ({}));
		vi.doMock("~/lib/data.server", () => data);
		vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
		vi.doMock("~/lib/plan.server", () => planServerMock());

		const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
		const result = await runScheduledMonitoring(envWith(vi.fn()), {
			includeScans: false,
			includeDigests: true,
			digestCadence: "weekly",
			scheduledTime: Date.parse("2026-07-13T05:00:00.000Z"),
		});

		expect(result).toMatchObject({
			digests: 3,
			digestAttempts: 4,
			digestFailures: 1,
		});
		expect(data.failDigestScheduleJob).toHaveBeenCalledTimes(1);
		expect(data.completeDigestScheduleJob).toHaveBeenCalledTimes(3);
		expect(deliverWeeklyDigest).toHaveBeenCalledTimes(4);
	});

	it("treats a resolved provider failure as a failed digest job", async () => {
		const data = dataServerMock();
		const deliverWeeklyDigest = vi.fn()
			.mockResolvedValueOnce({
				attempts: 1,
				channels: ["email"],
				details: [{ status: "failed" }],
			})
			.mockResolvedValue({
				attempts: 1,
				channels: ["email"],
				details: [{ status: "sent" }],
			});

		vi.doMock("~/lib/auth.server", () => ({}));
		vi.doMock("~/lib/data.server", () => data);
		vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
		vi.doMock("~/lib/plan.server", () => planServerMock());

		const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
		const result = await runScheduledMonitoring(envWith(vi.fn()), {
			includeScans: false,
			includeDigests: true,
			digestCadence: "weekly",
			scheduledTime: Date.parse("2026-07-13T05:00:00.000Z"),
		});

		expect(result).toMatchObject({ digests: 3, digestAttempts: 4, digestFailures: 1 });
		expect(data.failDigestScheduleJob).toHaveBeenCalledTimes(1);
	});

	it("keeps a scan-trouble digest job retryable when its notice is not accepted", async () => {
		const data = dataServerMock();
		data.listWatchEventsBetween.mockResolvedValue([]);
		const deliverScanTroubleNotice = vi.fn()
			.mockResolvedValueOnce({ sent: false, reason: "failed" })
			.mockResolvedValue({ sent: true, reason: "sent" });

		vi.doMock("~/lib/auth.server", () => ({}));
		vi.doMock("~/lib/data.server", () => data);
		vi.doMock("~/lib/delivery.server", () => ({
			deliverScanTroubleNotice,
			deliverWeeklyDigest: vi.fn(),
		}));
		vi.doMock("~/lib/plan.server", () => planServerMock());

		const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
		const result = await runScheduledMonitoring(envWith(vi.fn()), {
			includeScans: false,
			includeDigests: true,
			digestCadence: "weekly",
			scheduledTime: Date.parse("2026-07-13T05:00:00.000Z"),
		});

		expect(result).toMatchObject({ digests: 0, digestAttempts: 4, digestFailures: 1 });
		expect(data.failDigestScheduleJob).toHaveBeenCalledTimes(1);
		expect(data.completeDigestScheduleJob).toHaveBeenCalledTimes(3);
	});

	it.each(["disabled", "suppressed", "provider_unknown"] as const)(
		"completes scan-trouble jobs when delivery is intentionally %s",
		async (reason) => {
			const data = dataServerMock();
			data.listWatchEventsBetween.mockResolvedValue([]);
			const deliverScanTroubleNotice = vi.fn()
				.mockResolvedValue({ sent: false, reason });

			vi.doMock("~/lib/auth.server", () => ({}));
			vi.doMock("~/lib/data.server", () => data);
			vi.doMock("~/lib/delivery.server", () => ({
				deliverScanTroubleNotice,
				deliverWeeklyDigest: vi.fn(),
			}));
			vi.doMock("~/lib/plan.server", () => planServerMock());

			const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
			const result = await runScheduledMonitoring(envWith(vi.fn()), {
				includeScans: false,
				includeDigests: true,
				digestCadence: "weekly",
				scheduledTime: Date.parse("2026-07-13T05:00:00.000Z"),
			});

			expect(result).toMatchObject({ digests: 0, digestAttempts: 4, digestFailures: 0 });
			expect(data.failDigestScheduleJob).not.toHaveBeenCalled();
			expect(data.completeDigestScheduleJob).toHaveBeenCalledTimes(4);
		},
	);

	it("fails an unresolved strategy job without masking later successful customers", async () => {
		const data = dataServerMock();
		data.completeDigestStrategyGeneration
			.mockResolvedValueOnce(false)
			.mockResolvedValue(true);
		const deliverWeeklyDigest = vi.fn().mockResolvedValue({
			attempts: 1,
			channels: ["email"],
			details: [{ status: "sent" }],
		});

		vi.doMock("~/lib/auth.server", () => ({}));
		vi.doMock("~/lib/data.server", () => data);
		vi.doMock("~/lib/delivery.server", () => ({ deliverWeeklyDigest }));
		vi.doMock("~/lib/plan.server", () => planServerMock());

		const { runScheduledMonitoring } = await import("~/lib/monitoring.server");
		const result = await runScheduledMonitoring(envWith(vi.fn().mockResolvedValue(GOOD_PARAGRAPH)), {
			includeScans: false,
			includeDigests: true,
			digestCadence: "weekly",
			scheduledTime: Date.parse("2026-07-13T05:00:00.000Z"),
		});

		expect(result).toMatchObject({ digests: 3, digestAttempts: 4, digestFailures: 1 });
		expect(data.failDigestScheduleJob).toHaveBeenCalledTimes(1);
		expect(data.completeDigestScheduleJob).toHaveBeenCalledTimes(3);
		expect(deliverWeeklyDigest).toHaveBeenCalledTimes(3);
	});
});
