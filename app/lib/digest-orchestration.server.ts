import {
  type DigestCadence,
  digestMetadataForEvent,
} from "~/lib/change-intelligence";
import {
  claimDigestScheduleJob,
  claimDigestScheduleJobExhaustionAlert,
  completeDigestScheduleJob,
  createDigestRun,
	enqueueDigestScheduleJobs,
  exhaustStaleMaxAttemptDigestScheduleJobs,
  failDigestScheduleJob,
  getDigest,
  getDigestByPeriod,
  getSuccessfulRunStatsForUserBetween,
  getWorkspaceDeliveryConfig,
  listAdsByIds,
	listDigestScheduleJobsAwaitingAlert,
  listDigests,
  listEventCandidates,
  listRecentProofCapturesForWatchlist,
  listRetryableDigestRuns,
	listRetryableDigestScheduleJobs,
	settleDigestScheduleJobExhaustionAlert,
  listWatchEventsBetween,
  listWatchlists,
} from "~/lib/data.server";
import { reportScheduledTaskFailure } from "~/lib/cron-failure-alert.server";
import { isCustomerDigestEligibleEvent } from "~/lib/delivery-policy.server";
import { deliveryPreDispatchStaleBefore } from "~/lib/delivery-attempt-lease";
import {
  DIGEST_ITEM_SET_PROVENANCE,
  readDigestSourceEventId,
  selectDigestCohort,
} from "~/lib/digest-provenance";
import {
  createDigestStrategyGenerationDeadline,
  createDigestStrategyGenerationLease,
  recoverDigestStrategyGeneration,
  settleDigestStrategyGeneration,
} from "~/lib/digest-strategy-generation.server";
import {
  DIGEST_STRATEGY_GENERATION_PENDING,
  readDigestStrategyNote,
  readPendingDigestStrategyGeneration,
} from "~/lib/digest-strategy";
import type { AppEnv } from "~/lib/env.server";
import { getUserPlan, PLAN_LIMITS } from "~/lib/plan.server";
import { planAllowsDigestCadence } from "~/lib/plan-entitlements";
import type {
  DigestRecord,
  EventCandidateRecord,
  ProofCaptureRecord,
  WatchEventRecord,
  WatchEventType,
  WatchlistRecord,
} from "~/lib/types";
import {
  classifyWatchPeriodTriage,
  readTriageFromDigestSummary,
  triageToDigestSummary,
  type WatchPeriodTriage,
} from "~/lib/watch-event-evaluator.server";

const DAILY_DIGEST_LOOKBACK_DAYS = 1;
const WEEKLY_DIGEST_LOOKBACK_DAYS = 7;
const DIGEST_RETRY_WINDOW_DAYS = 7;
const DIGEST_RETRY_SWEEP_LIMIT = 25;
const DIGEST_SCHEDULE_JOB_SWEEP_LIMIT = 50;
const DIGEST_SCHEDULE_JOB_MAX_ATTEMPTS = 5;
const DIGEST_SCHEDULE_JOB_LEASE_MS = 15 * 60 * 1000;
const DIGEST_SCHEDULE_JOB_ALERT_LEASE_MS = 15 * 60 * 1000;
const DAILY_HEARTBEAT_QUIET_STREAK = 3;
// Zero-noise triage sources: recent candidates carry the suppressed/detected
// statuses that never become watch events, and recent proof captures carry
// the failed/pending evidence states. Both are loaded newest-first with a
// generous cap and filtered to the digest period below.
const DIGEST_TRIAGE_CANDIDATE_LIMIT = 500;
const DIGEST_TRIAGE_PROOF_LIMIT = 100;

export interface DigestOrchestrationOptions {
  cadence?: DigestCadence;
  lookbackDays?: number;
  periodEnd?: number | string | Date;
  deadlineAt?: number;
}

export interface DigestDeliveryCycleResult {
  attempted: number;
  sent: number;
  failed: number;
}

const EMPTY_DIGEST_DELIVERY_CYCLE_RESULT: DigestDeliveryCycleResult = {
  attempted: 0,
  sent: 0,
  failed: 0,
};

function combineDigestDeliveryCycleResults(
  left: DigestDeliveryCycleResult,
  right: DigestDeliveryCycleResult,
): DigestDeliveryCycleResult {
  return {
    attempted: left.attempted + right.attempted,
    sent: left.sent + right.sent,
    failed: left.failed + right.failed,
  };
}

interface DigestUser {
  id: string;
  email: string;
  name: string;
}

interface DigestSourceItem {
  eventId: string;
  watchlistId: string;
  watchlistName: string;
  eventType: WatchEventType;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
}

async function deliverScanTroubleNoticeOrThrow(
  env: AppEnv,
  input: {
    userId: string;
    accountEmail: string;
    watchlistNames: string[];
    periodKey: string;
  },
) {
  const { deliverScanTroubleNotice } = await import("~/lib/delivery.server");
  const delivery = await deliverScanTroubleNotice(env, input);
  if (!delivery.sent) {
    if (
      delivery.reason === "disabled" ||
      delivery.reason === "unverified" ||
      delivery.reason === "no_email" ||
      delivery.reason === "suppressed" ||
      delivery.reason === "provider_unknown"
    ) {
      return;
    }
    throw new Error(
      `Scan-trouble notice was not accepted (${delivery.reason}).`,
    );
  }
}

function countAcceptedDigestDelivery(delivery: {
  attempts: number;
  details?: Array<{ status?: string }>;
}) {
  // Production delivery always returns detail rows. The fallback preserves the
  // long-standing numeric contract for narrow unit-test doubles only.
  if (!Array.isArray(delivery.details)) return delivery.attempts > 0 ? 1 : 0;
  if (delivery.details.some((attempt) => attempt.status !== "sent")) {
    throw new Error("Digest delivery was not accepted by every selected provider.");
  }
  return delivery.details.some((attempt) => attempt.status === "sent") ? 1 : 0;
}

export async function runDigestDeliveryCycle(
  env: AppEnv,
  options: DigestOrchestrationOptions = {},
) {
  return (await runDigestDeliveryCycleDetailed(env, options)).sent;
}

export async function runDigestDeliveryCycleDetailed(
  env: AppEnv,
  options: DigestOrchestrationOptions = {},
): Promise<DigestDeliveryCycleResult> {
  if (!env.DB) return { ...EMPTY_DIGEST_DELIVERY_CYCLE_RESULT };

  const cadence = options.cadence ?? "weekly";
  const lookbackDays =
    options.lookbackDays ??
    (cadence === "daily"
      ? DAILY_DIGEST_LOOKBACK_DAYS
      : WEEKLY_DIGEST_LOOKBACK_DAYS);
  const periodEnd =
    options.periodEnd === undefined ? new Date() : new Date(options.periodEnd);
  const periodStart = new Date(
    periodEnd.getTime() - lookbackDays * 24 * 60 * 60 * 1000,
  );
  const periodStartIso = periodStart.toISOString();
  const periodEndIso = periodEnd.toISOString();
  const strategyGenerationDeadlineAt = createDigestStrategyGenerationDeadline(
    options.deadlineAt,
  );

  // Read retry candidates before claiming this period so retries cannot race
  // a digest created by the same scheduled invocation.
  const retryCandidates = await listRetryableDigestRuns(env, {
    since: new Date(
      periodEnd.getTime() - DIGEST_RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    stalePreDispatchBefore: deliveryPreDispatchStaleBefore(periodEnd.getTime()),
    limit: DIGEST_RETRY_SWEEP_LIMIT,
  });
  await enqueueDigestScheduleJobs(env, {
		cadence,
		periodStart: periodStartIso,
		periodEnd: periodEndIso,
	});

  const handledDigestRunIds = new Set<string>();
  const scheduled = await drainDigestScheduleJobs(env, {
		deadlineAt: options.deadlineAt,
		strategyGenerationDeadlineAt,
		handledDigestRunIds,
	});

  const retried = await retryFailedDigests(env, {
    retryCandidates,
    handledDigestRunIds,
    strategyGenerationDeadlineAt,
		deadlineAt: options.deadlineAt,
  });
  return combineDigestDeliveryCycleResults(scheduled, retried);
}

export async function resumePendingDigestScheduleJobs(
	env: AppEnv,
	options: { deadlineAt?: number } = {},
) {
	return (await resumePendingDigestScheduleJobsDetailed(env, options)).sent;
}

export async function resumePendingDigestScheduleJobsDetailed(
	env: AppEnv,
	options: { deadlineAt?: number } = {},
): Promise<DigestDeliveryCycleResult> {
	if (!env.DB) return { ...EMPTY_DIGEST_DELIVERY_CYCLE_RESULT };
	const handledDigestRunIds = new Set<string>();
	const strategyGenerationDeadlineAt = createDigestStrategyGenerationDeadline(
		options.deadlineAt,
	);
	return drainDigestScheduleJobs(env, {
		deadlineAt: options.deadlineAt,
		strategyGenerationDeadlineAt,
		handledDigestRunIds,
	});
}

async function drainDigestScheduleJobs(
	env: AppEnv,
	input: {
		deadlineAt?: number;
		strategyGenerationDeadlineAt: number;
		handledDigestRunIds: Set<string>;
	},
) {
	const now = Date.now();
  const staleRunningBefore = new Date(
    now - DIGEST_SCHEDULE_JOB_LEASE_MS,
  ).toISOString();
  await exhaustStaleMaxAttemptDigestScheduleJobs(env, {
    staleRunningBefore,
    maxAttempts: DIGEST_SCHEDULE_JOB_MAX_ATTEMPTS,
    now: new Date(now).toISOString(),
  });
	const candidates = await listRetryableDigestScheduleJobs(env, {
    staleRunningBefore,
		maxAttempts: DIGEST_SCHEDULE_JOB_MAX_ATTEMPTS,
		limit: DIGEST_SCHEDULE_JOB_SWEEP_LIMIT,
	});
	const result = { ...EMPTY_DIGEST_DELIVERY_CYCLE_RESULT };

	for (const candidate of candidates) {
		if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) break;
		const processingToken = crypto.randomUUID();
		const claimNow = new Date().toISOString();
		const claimed = await claimDigestScheduleJob(env, {
			jobId: candidate.id,
			processingToken,
			now: claimNow,
			staleRunningBefore: new Date(
				Date.now() - DIGEST_SCHEDULE_JOB_LEASE_MS,
			).toISOString(),
			maxAttempts: DIGEST_SCHEDULE_JOB_MAX_ATTEMPTS,
		});
		if (!claimed) continue;
		result.attempted += 1;

		try {
			result.sent += await runDigestForUser(env, {
				user: {
					id: claimed.userId,
					email: claimed.userEmail,
					name: claimed.userName,
				},
				cadence: claimed.cadence,
				periodStart: claimed.periodStart,
				periodEnd: claimed.periodEnd,
				strategyGenerationDeadlineAt: input.strategyGenerationDeadlineAt,
				handledDigestRunIds: input.handledDigestRunIds,
			});
			const completed = await completeDigestScheduleJob(env, {
				jobId: claimed.id,
				processingToken,
				now: new Date().toISOString(),
			});
			if (!completed) {
				throw new Error("Digest schedule job completion ownership was lost.");
			}
		} catch (error) {
			result.failed += 1;
      const exhausted =
        claimed.attemptCount >= DIGEST_SCHEDULE_JOB_MAX_ATTEMPTS;
			const failed = await failDigestScheduleJob(env, {
				jobId: claimed.id,
				processingToken,
				now: new Date().toISOString(),
				errorCode: exhausted
					? "digest_schedule_job_exhausted"
					: "digest_schedule_job_failed",
				exhausted,
			});
			if (failed && exhausted) {
				try {
          await reportExhaustedDigestScheduleJobs(env, {
            limit: 1,
            jobId: claimed.id,
          });
				} catch (alertError) {
					// The exhausted row remains durable and the separate recovery sweep
					// will retry its alert. Alerting must not strand later workspaces.
          console.error(
            "Digest schedule exhaustion alert failed; recovery will retry.",
            {
						jobId: claimed.id,
              error:
                alertError instanceof Error
                  ? alertError.message
                  : String(alertError),
            },
          );
				}
			}
			// The durable failed row remains reclaimable. Continue so one workspace
			// cannot prevent later customers from receiving their digest.
			console.error(
				`Digest schedule job ${claimed.id} failed; continuing with remaining jobs.`,
				error,
			);
		}
	}

	return result;
}

export async function reportExhaustedDigestScheduleJobs(
	env: AppEnv,
	options: { limit?: number; jobId?: string } = {},
) {
	return (await reportExhaustedDigestScheduleJobsDetailed(env, options)).alerted;
}

export async function reportExhaustedDigestScheduleJobsDetailed(
	env: AppEnv,
	options: { limit?: number; jobId?: string } = {},
) {
	if (!env.DB) return { attempted: 0, alerted: 0, failed: 0 };
	const now = Date.now();
  const staleRunningBefore = new Date(
    now - DIGEST_SCHEDULE_JOB_LEASE_MS,
  ).toISOString();
  await exhaustStaleMaxAttemptDigestScheduleJobs(env, {
    staleRunningBefore,
    maxAttempts: DIGEST_SCHEDULE_JOB_MAX_ATTEMPTS,
    now: new Date(now).toISOString(),
  });
	const candidates = await listDigestScheduleJobsAwaitingAlert(env, {
    staleAlertBefore: new Date(
      now - DIGEST_SCHEDULE_JOB_ALERT_LEASE_MS,
    ).toISOString(),
		limit: options.limit ?? 25,
	});
	let alerted = 0;
	let attempted = 0;
	let failed = 0;
	for (const candidate of candidates) {
		if (options.jobId && candidate.id !== options.jobId) continue;
		const alertToken = crypto.randomUUID();
		const claimed = await claimDigestScheduleJobExhaustionAlert(env, {
			jobId: candidate.id,
			alertToken,
			now: new Date().toISOString(),
			staleAlertBefore: new Date(
				Date.now() - DIGEST_SCHEDULE_JOB_ALERT_LEASE_MS,
			).toISOString(),
		});
		if (!claimed) continue;
		attempted += 1;

		const result = await reportScheduledTaskFailure(
			env,
			`digest_schedule_job_exhausted:${claimed.id}`,
			new Error(
				`Digest ${claimed.cadence} period ${claimed.periodStart} to ${claimed.periodEnd} exhausted ${claimed.attemptCount} attempts.`,
			),
			{ jobId: claimed.id, cadence: claimed.cadence },
		);
    const alertRecorded =
      result.reason === "sent" || result.reason === "throttled";
		if (!alertRecorded) failed += 1;
		await settleDigestScheduleJobExhaustionAlert(env, {
			jobId: claimed.id,
			alertToken,
			now: new Date().toISOString(),
			alerted: alertRecorded,
		});
		if (alertRecorded) alerted += 1;
	}
	return { attempted, alerted, failed };
}

async function runDigestForUser(
  env: AppEnv,
  input: {
    user: DigestUser;
    cadence: DigestCadence;
    periodStart: string;
    periodEnd: string;
    strategyGenerationDeadlineAt: number;
    handledDigestRunIds: Set<string>;
  },
) {
  const { user, cadence, periodStart, periodEnd } = input;
  const plan = await getUserPlan(env, user.id);
  if (!PLAN_LIMITS[plan].digests || !planAllowsDigestCadence(plan, cadence)) {
    return 0;
  }

  // Monday double-digest firewall: users who also receive the weekly (05:00 UTC
  // Monday) skip the daily brief so they do not get two overlapping emails.
  if (
    cadence === "daily" &&
    new Date(periodEnd).getUTCDay() === 1 &&
    planAllowsDigestCadence(plan, "weekly")
  ) {
    return 0;
  }

  // Customer preference: weekly_only skips daily jobs (Starter/Agency opt-down).
  if (cadence === "daily") {
    const workspaceConfig = await getWorkspaceDeliveryConfig(env, user.id);
    if (workspaceConfig?.digestCadencePreference === "weekly_only") {
      return 0;
    }
  }

  const watchlists = await listWatchlists(env, user.id);
  const eligibleByWatchlist: Array<{
    watchlist: WatchlistRecord;
    events: WatchEventRecord[];
  }> = [];
  // Zero-noise triage (2026-08-06): all period watch events are collected
  // unfiltered so the period's truthful classification never depends on the
  // customer-eligibility filter dropping suppressed or pending records.
  const triageEvents: Array<Pick<WatchEventRecord, "status">> = [];
  for (const watchlist of watchlists) {
    const events = await listWatchEventsBetween(
      env,
      watchlist.id,
      periodStart,
      periodEnd,
    );
    triageEvents.push(...events);
    eligibleByWatchlist.push({
      watchlist,
      events: events.filter(isCustomerDigestEligibleEvent),
    });
  }

  const adIds = eligibleByWatchlist.flatMap(({ events }) =>
    events
      .map((event) => event.adId)
      .filter((adId): adId is string => Boolean(adId)),
  );
  const adsById = new Map(
    (await listAdsByIds(env, adIds)).map((ad) => [ad.metaAdId, ad]),
  );
  const digestItems: DigestSourceItem[] = [];
  for (const { watchlist, events } of eligibleByWatchlist) {
    for (const event of events) {
      const ad = event.adId ? (adsById.get(event.adId) ?? null) : null;
      digestItems.push({
        eventId: event.id,
        watchlistId: watchlist.id,
        watchlistName: watchlist.name,
        eventType: event.eventType,
        title: event.title,
        summary: event.summary,
        metadata: {
          ...digestMetadataForEvent(event, undefined, ad),
          eventId: event.id,
        },
      });
    }
  }

  const digestCohort = selectDigestCohort(digestItems);
  const selectedDigestItems = digestCohort.items;
  const orderedDigestItems = selectDigestCohort(
    digestItems,
    digestItems.length,
  ).items;
  const existingDigest = await getDigestByPeriod(
    env,
    user.id,
    periodStart,
    periodEnd,
  );
  if (existingDigest?.delivery?.status === "sent") return 0;

  // A successful quiet period is retained value. An unscanned period is not.
  let heartbeat: {
    runs: number;
    watchlistsChecked: number;
    adsSeen: number;
  } | null = null;
  // Zero-noise triage: only the quiet path needs it (periods with digest
  // items already carry their truth as change events), so the extra
  // candidate/proof queries only run when they decide the story.
  let periodTriage: WatchPeriodTriage | null = null;
  if (!existingDigest && digestItems.length === 0) {
    const runStats = await getSuccessfulRunStatsForUserBetween(
      env,
      user.id,
      periodStart,
      periodEnd,
    );
    if (runStats.runs === 0) {
      // Paid digests with active watchlists but zero successful scans: tell the
      // customer instead of going silent (operator already has at-risk mail).
      if (watchlists.length > 0) {
        await deliverScanTroubleNoticeOrThrow(env, {
          userId: user.id,
          accountEmail: user.email,
          watchlistNames: watchlists.map((watchlist) => watchlist.name),
          periodKey: `${periodStart.slice(0, 10)}_${periodEnd.slice(0, 10)}`,
        });
      }
      return 0;
    }
    heartbeat = runStats;
    periodTriage = classifyWatchPeriodTriage({
      events: triageEvents,
      candidates: await collectPeriodEventCandidates(env, watchlists, {
        periodStart,
        periodEnd,
      }),
      proofCaptures: await collectPeriodProofCaptures(env, watchlists, {
        periodStart,
        periodEnd,
      }),
      successfulRuns: runStats.runs,
      lastSuccessfulCheckAt: lastSuccessfulCheckAtInPeriod(
        watchlists,
        periodStart,
        periodEnd,
      ),
    });
    // WP-21 heartbeat auto-degrade: after 3 consecutive daily all-quiet
    // heartbeats, stay silent on further quiet days. Only a genuinely
    // all-quiet current period may be auto-silenced; a non-quiet triage
    // (evidence-failed, evidence-pending, routine-only) is classified,
    // persisted, and delivered so it breaks the streak instead of being
    // silently lost. No digest run is created for a skipped day, so the
    // derived streak persists until a period with findings resets it.
    // Weekly heartbeats are unaffected.
    if (
      cadence === "daily" &&
      periodTriage.status === "all_quiet" &&
      (await hasDailyQuietHeartbeatStreak(env, user.id))
    ) {
      return 0;
    }
  }

  let strategyParagraph: string | null = null;
  const strategyGenerationRequired =
    cadence === "weekly" &&
    selectedDigestItems.length > 0 &&
    (plan === "starter" || plan === "agency");
  const initialStrategyLease = strategyGenerationRequired
    ? createDigestStrategyGenerationLease()
    : null;
  const digestSummary: Record<string, unknown> = {
    totalEvents: digestCohort.totalEligibleEvents,
    totalEligibleEvents: digestCohort.totalEligibleEvents,
    includedEvents: digestCohort.includedEvents,
    omittedEvents: digestCohort.omittedEvents,
    watchlists: watchlists.length,
    ...(periodTriage ? triageToDigestSummary(periodTriage) : {}),
    ...(initialStrategyLease
      ? {
          strategyGenerationStatus: DIGEST_STRATEGY_GENERATION_PENDING,
          strategyGenerationLeaseId: initialStrategyLease.leaseId,
          strategyGenerationLeaseExpiresAt: initialStrategyLease.leaseExpiresAt,
        }
      : {}),
  };
  const candidateItems = orderedDigestItems.map((item) => ({
    watchlistId: item.watchlistId,
    watchlistName: item.watchlistName,
    eventType: item.eventType,
    title: item.title,
    summary: item.summary,
    metadata: item.metadata,
  }));

  let digestRunId: string;
  let canonicalDigest = existingDigest;
  if (existingDigest) {
    digestRunId = existingDigest.id;
    if (!hasCompleteDigestItemSet(existingDigest)) {
      throw new Error(
        "Digest run is incomplete and its original candidate identity cannot be proven.",
      );
    }
    if (readPendingDigestStrategyGeneration(existingDigest.summary)) {
      input.handledDigestRunIds.add(digestRunId);
      const recovery = await recoverDigestStrategyGeneration(env, {
        digest: existingDigest,
        periodStart,
        periodEnd,
        plan,
        strategyGenerationDeadlineAt: input.strategyGenerationDeadlineAt,
      });
      if (
        recovery.outcome === "active" ||
        recovery.outcome === "claim_lost" ||
        recovery.outcome === "settlement_lost"
      ) {
        throw new Error("Digest strategy recovery did not reach a terminal state.");
      }
      if (recovery.outcome === "settled") {
        strategyParagraph = recovery.strategyParagraph;
        canonicalDigest = recovery.digest;
      }
    }
  } else {
    const claim = await createDigestRun(
      env,
      user.id,
      periodStart,
      periodEnd,
      digestSummary,
      { returnClaim: true, items: candidateItems },
    );
    digestRunId = claim.digestRunId;
    if (!claim.created) {
      input.handledDigestRunIds.add(digestRunId);
      throw new Error("Digest run identity was claimed by another writer.");
    }

    if (initialStrategyLease) {
      const settled = await settleDigestStrategyGeneration(env, {
        digestRunId,
        leaseId: initialStrategyLease.leaseId,
        summary: digestSummary,
        items: selectedDigestItems,
        periodStart,
        periodEnd,
        plan,
        strategyGenerationDeadlineAt: input.strategyGenerationDeadlineAt,
      });
      if (!settled) {
        input.handledDigestRunIds.add(digestRunId);
        throw new Error("Digest strategy generation did not settle.");
      }
      strategyParagraph = settled.strategyParagraph;
    }
  }
  input.handledDigestRunIds.add(digestRunId);

  const deliverySnapshot = canonicalDigest
    ? buildPersistedDigestDeliverySnapshot(canonicalDigest)
    : {
        items: selectedDigestItems,
        strategyParagraph,
        ...readDigestDeliveryCohortCounts(
          digestSummary,
          selectedDigestItems.length,
        ),
      };
  if (deliverySnapshot.items.length > 0) {
    heartbeat = null;
  } else if (!heartbeat) {
    const runStats = await getSuccessfulRunStatsForUserBetween(
      env,
      user.id,
      periodStart,
      periodEnd,
    );
    if (runStats.runs === 0) {
      if (watchlists.length > 0) {
        await deliverScanTroubleNoticeOrThrow(env, {
          userId: user.id,
          accountEmail: user.email,
          watchlistNames: watchlists.map((watchlist) => watchlist.name),
          periodKey: `${periodStart.slice(0, 10)}_${periodEnd.slice(0, 10)}`,
        });
      }
      return 0;
    }
    heartbeat = runStats;
  }

  const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
  // Zero-noise triage rides the heartbeat so the email renderer sees the
  // period's truthful classification without touching the delivery module:
  // the persisted summary is the durable source, replayed on retries too.
  // Legacy digests without a triage keep a byte-identical heartbeat.
  const persistedTriage = readTriageFromDigestSummary(
    canonicalDigest?.summary ?? digestSummary,
  );
  const deliveryHeartbeat = heartbeat
    ? persistedTriage
      ? { ...heartbeat, triage: persistedTriage }
      : heartbeat
    : null;
  const delivery = await deliverWeeklyDigest(env, {
    heartbeat: deliveryHeartbeat,
    userId: user.id,
    userName: user.name,
    accountEmail: user.email,
    digestRunId,
    periodStart,
    periodEnd,
    ...deliverySnapshot,
    cadence,
    lane: "customer",
    // Brief-as-retention-loop (lane 1, 2026-08-14): the four retention
    // fields the weekly email surfaces — derived here from the prior
    // digest on file and the next scheduled scan. Absent values render
    // explicit unavailable copy in the email body.
    ...(await loadRetentionInputsForDigest(env, {
      userId: user.id,
      plan,
      periodEnd,
    })),
  });
  return countAcceptedDigestDelivery(delivery);
}

async function retryFailedDigests(
  env: AppEnv,
  input: {
    retryCandidates: Awaited<ReturnType<typeof listRetryableDigestRuns>>;
    handledDigestRunIds: Set<string>;
    strategyGenerationDeadlineAt: number;
		deadlineAt?: number;
  },
) {
  const result = { ...EMPTY_DIGEST_DELIVERY_CYCLE_RESULT };
  for (const candidate of input.retryCandidates) {
		if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) break;
    if (input.handledDigestRunIds.has(candidate.id)) continue;
    result.attempted += 1;
    try {
      const plan = await getUserPlan(env, candidate.userId);
      const cadence = digestCadenceForPeriod(
        candidate.periodStart,
        candidate.periodEnd,
      );
      if (!PLAN_LIMITS[plan].digests || !planAllowsDigestCadence(plan, cadence))
        continue;

      const digest = await getDigest(env, candidate.id);
      if (!digest || !hasCompleteDigestItemSet(digest)) continue;
      let deliveryDigest = digest;
      const recovery = await recoverDigestStrategyGeneration(env, {
        digest,
        periodStart: candidate.periodStart,
        periodEnd: candidate.periodEnd,
        plan,
        strategyGenerationDeadlineAt: input.strategyGenerationDeadlineAt,
      });
      if (
        recovery.outcome === "active" ||
        recovery.outcome === "claim_lost" ||
        recovery.outcome === "settlement_lost"
      ) {
        throw new Error("Digest strategy recovery did not reach a terminal state.");
      }
      if (recovery.outcome === "settled") deliveryDigest = recovery.digest;

      let heartbeat: {
        runs: number;
        watchlistsChecked: number;
        adsSeen: number;
      } | null = null;
      if (deliveryDigest.items.length === 0) {
        const runStats = await getSuccessfulRunStatsForUserBetween(
          env,
          candidate.userId,
          candidate.periodStart,
          candidate.periodEnd,
        );
        if (runStats.runs === 0) {
          const userWatchlists = await listWatchlists(env, candidate.userId);
          if (userWatchlists.length > 0) {
            await deliverScanTroubleNoticeOrThrow(env, {
              userId: candidate.userId,
              accountEmail: candidate.userEmail,
              watchlistNames: userWatchlists.map((watchlist) => watchlist.name),
              periodKey: `${candidate.periodStart.slice(0, 10)}_${candidate.periodEnd.slice(0, 10)}`,
            });
          }
          continue;
        }
        heartbeat = runStats;
      }

      const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
      // Retries replay the persisted triage verbatim: a period that was
      // routine-only or evidence-failed must not re-render as an all-quiet
      // heartbeat after recovery. Legacy digests stay byte-identical.
      const persistedTriage = readTriageFromDigestSummary(deliveryDigest.summary);
      const deliveryHeartbeat = heartbeat
        ? persistedTriage
          ? { ...heartbeat, triage: persistedTriage }
          : heartbeat
        : null;
      const delivery = await deliverWeeklyDigest(env, {
        heartbeat: deliveryHeartbeat,
        userId: candidate.userId,
        userName: candidate.userName,
        accountEmail: candidate.userEmail,
        digestRunId: candidate.id,
        periodStart: candidate.periodStart,
        periodEnd: candidate.periodEnd,
        ...buildPersistedDigestDeliverySnapshot(deliveryDigest),
        cadence,
        lane: "customer",
        // Brief-as-retention-loop (lane 1): retries carry the same retention
        // inputs as first sends. Without them a retried brief renders the
        // false "first brief on file" baseline and the explicit-unavailable
        // expiry even though the workspace has both on file.
        ...(await loadRetentionInputsForDigest(env, {
          userId: candidate.userId,
          plan,
          periodEnd: candidate.periodEnd,
        })),
      });
      result.sent += countAcceptedDigestDelivery(delivery);
    } catch (error) {
      result.failed += 1;
      console.error(
        `Digest retry failed for digest run ${candidate.id}; continuing with remaining retries.`,
        error,
      );
    }
  }
  return result;
}

export function buildPersistedDigestDeliverySnapshot(digest: DigestRecord) {
  const items = digest.items.map((item) => ({
    eventId: requireDigestSourceEventId(item.metadata),
    watchlistId: item.watchlistId,
    watchlistName: item.watchlistName,
    eventType: item.eventType,
    title: item.title,
    summary: item.summary,
    metadata: item.metadata,
  }));
  return {
    items,
    ...readDigestDeliveryCohortCounts(digest.summary, items.length),
    // Persisted strategy text is replayed verbatim; retries never regenerate it.
    strategyParagraph:
      readDigestStrategyNote(digest.summary)?.paragraph ?? null,
  };
}

export function hasCompleteDigestItemSet(digest: {
  summary?: Record<string, unknown>;
  items: ReadonlyArray<{ metadata?: Record<string, unknown> }>;
}) {
  if (digest.summary?.digestItemSetProvenance !== DIGEST_ITEM_SET_PROVENANCE) {
    return false;
  }
  const expectedItemCount = readDigestExpectedItemCount(digest.summary);
  return (
    expectedItemCount !== null &&
    digest.items.length === expectedItemCount &&
    digest.items.every(
      (item) => readDigestSourceEventId(item.metadata) !== null,
    )
  );
}

function readDigestDeliveryCohortCounts(
  summary: Record<string, unknown> | undefined,
  includedItemCount: number,
) {
  const total = readNonNegativeInteger(summary?.totalEligibleEvents);
  const included = readNonNegativeInteger(summary?.includedEvents);
  const omitted = readNonNegativeInteger(summary?.omittedEvents);
  if (
    total === null ||
    included === null ||
    omitted === null ||
    included !== includedItemCount ||
    total !== included + omitted
  ) {
    return {
      totalEligibleEvents: includedItemCount,
      includedEvents: includedItemCount,
      omittedEvents: 0,
    };
  }
  return {
    totalEligibleEvents: total,
    includedEvents: included,
    omittedEvents: omitted,
  };
}

function requireDigestSourceEventId(
  metadata: Record<string, unknown> | undefined,
) {
  const eventId = readDigestSourceEventId(metadata);
  if (!eventId) {
    throw new Error(
      "Digest item is missing its original watch_event ID; retry is unsafe.",
    );
  }
  return eventId;
}

function readDigestExpectedItemCount(summary?: Record<string, unknown>) {
	const hasCohortCounts =
    Object.prototype.hasOwnProperty.call(
      summary ?? {},
      "totalEligibleEvents",
    ) ||
		Object.prototype.hasOwnProperty.call(summary ?? {}, "includedEvents") ||
		Object.prototype.hasOwnProperty.call(summary ?? {}, "omittedEvents");
	if (hasCohortCounts) {
		const total = readNonNegativeInteger(summary?.totalEligibleEvents);
		const included = readNonNegativeInteger(summary?.includedEvents);
		const omitted = readNonNegativeInteger(summary?.omittedEvents);
    return total !== null &&
      included !== null &&
      omitted !== null &&
      total === included + omitted
			? included
			: null;
	}
  const expectedItemCount = summary?.totalEvents;
  return Number.isSafeInteger(expectedItemCount) &&
    Number(expectedItemCount) >= 0
    ? Number(expectedItemCount)
    : null;
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * WP-21 heartbeat auto-degrade streak, derived from existing digest history
 * (no new table or migration): true when the user's most recent
 * DAILY_HEARTBEAT_QUIET_STREAK digest runs are all daily all-quiet heartbeats
 * (zero items over a daily-sized period). Any digest with movement — or a
 * weekly digest — breaks the streak and lets daily heartbeats resume.
 *
 * Zero-noise (2026-08-06): a routine-only or evidence-pending day is NOT a
 * quiet day, so its persisted triage also breaks the streak — silence must
 * never auto-degrade over days that had real findings.
 */
async function hasDailyQuietHeartbeatStreak(env: AppEnv, userId: string) {
  const recentDigests = await listDigests(
    env,
    userId,
    DAILY_HEARTBEAT_QUIET_STREAK,
  );
  return (
    recentDigests.length >= DAILY_HEARTBEAT_QUIET_STREAK &&
    recentDigests.every(
      (digest) =>
        digest.items.length === 0 &&
        digestCadenceForPeriod(digest.periodStart, digest.periodEnd) ===
          "daily" &&
        isQuietTriageDigest(digest.summary),
    )
  );
}

/** Legacy digests without a triage count as quiet; any real finding breaks the streak. */
function isQuietTriageDigest(summary: Record<string, unknown> | undefined) {
  const triage = readTriageFromDigestSummary(summary);
  return triage === null || triage.status === "all_quiet";
}

async function collectPeriodEventCandidates(
  env: AppEnv,
  watchlists: WatchlistRecord[],
  period: { periodStart: string; periodEnd: string },
) {
  const candidates: Array<
    Pick<EventCandidateRecord, "status" | "dedupeReason">
  > = [];
  for (const watchlist of watchlists) {
    const recent = await listEventCandidates(
      env,
      watchlist.id,
      DIGEST_TRIAGE_CANDIDATE_LIMIT,
    );
    for (const candidate of recent) {
      const at = candidate.detectedAt ?? candidate.createdAt;
      if (at >= period.periodStart && at <= period.periodEnd) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

async function collectPeriodProofCaptures(
  env: AppEnv,
  watchlists: WatchlistRecord[],
  period: { periodStart: string; periodEnd: string },
) {
  const captures: Array<
    Pick<ProofCaptureRecord, "status">
  > = [];
  for (const watchlist of watchlists) {
    const recent = await listRecentProofCapturesForWatchlist(
      env,
      watchlist.id,
      DIGEST_TRIAGE_PROOF_LIMIT,
    );
    for (const capture of recent) {
      if (capture.attemptedAt >= period.periodStart && capture.attemptedAt <= period.periodEnd) {
        captures.push(capture);
      }
    }
  }
  return captures;
}

function lastSuccessfulCheckAtInPeriod(
  watchlists: WatchlistRecord[],
  periodStart: string,
  periodEnd: string,
) {
  return watchlists.reduce<string | null>((latest, watchlist) => {
    const at = watchlist.lastScannedAt;
    if (!at || at < periodStart || at > periodEnd) return latest;
    return !latest || at > latest ? at : latest;
  }, null);
}

function digestCadenceForPeriod(
  periodStart: string,
  periodEnd: string,
): DigestCadence {
  const spanMs =
    new Date(periodEnd).getTime() - new Date(periodStart).getTime();
  return spanMs <= 36 * 60 * 60 * 1000 ? "daily" : "weekly";
}

/**
 * Brief-as-retention-loop (lane 1, 2026-08-14): the four retention fields
 * the weekly email carries above its accountability block are computed
 * here so the email renderer never has to query D1 or invent content.
 * The previous digest on file is looked up by `period_end` strictly older
 * than the current run; the next scheduled scan anchors the expiry field.
 * Failures (no DB, no workspace) render their explicit unavailable state
 * in the email body — never a fabricated value.
 */
async function loadRetentionInputsForDigest(
  env: AppEnv,
  input: {
    userId: string;
    plan: string;
    periodEnd: string;
  },
): Promise<{
  previousBriefItemCount: number | null;
  hasPreviousBrief: boolean | null;
  nextScanAt: string | null;
  nextScanLabel: string | null;
}> {
  const { formatNextScanLabel, nextScheduledScanAt } = await import(
    "~/lib/schedule-display"
  );
  let previousBriefItemCount: number | null = null;
  let hasPreviousBrief: boolean | null = false;
  try {
    const digests = await listDigests(env, input.userId);
    const previous = digests.find(
      (digest) => digest.periodEnd < input.periodEnd,
    );
    if (previous) {
      hasPreviousBrief = true;
      previousBriefItemCount = previous.items?.length ?? 0;
    }
  } catch {
    // Swallow the lookup failure: the email body renders the explicit
    // "first brief on file" baseline line instead of inventing a count.
  }
  const nextScan = nextScheduledScanAt(input.plan, new Date());
  return {
    previousBriefItemCount,
    hasPreviousBrief,
    nextScanAt: nextScan.toISOString(),
    nextScanLabel: formatNextScanLabel(input.plan, new Date(), null),
  };
}
