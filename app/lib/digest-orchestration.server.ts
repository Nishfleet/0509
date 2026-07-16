import {
  type DigestCadence,
  digestMetadataForEvent,
} from "~/lib/change-intelligence";
import {
  createDigestRun,
  getDigest,
  getDigestByPeriod,
  getSuccessfulRunStatsForUserBetween,
  listAdsByIds,
  listRetryableDigestRuns,
  listWatchEventsBetween,
  listWatchlists,
} from "~/lib/data.server";
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
  WatchEventRecord,
  WatchEventType,
  WatchlistRecord,
} from "~/lib/types";

const DAILY_DIGEST_LOOKBACK_DAYS = 1;
const WEEKLY_DIGEST_LOOKBACK_DAYS = 7;
const DIGEST_RETRY_WINDOW_DAYS = 7;
const DIGEST_RETRY_SWEEP_LIMIT = 25;

export interface DigestOrchestrationOptions {
  cadence?: DigestCadence;
  lookbackDays?: number;
  periodEnd?: number | string | Date;
  deadlineAt?: number;
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

export async function runDigestDeliveryCycle(
  env: AppEnv,
  options: DigestOrchestrationOptions = {},
) {
  if (!env.DB) return 0;

  const cadence = options.cadence ?? "weekly";
  const lookbackDays =
    options.lookbackDays ??
    (cadence === "daily" ? DAILY_DIGEST_LOOKBACK_DAYS : WEEKLY_DIGEST_LOOKBACK_DAYS);
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
  const usersResult = await env.DB.prepare(
    `
      SELECT DISTINCT user.id, user.email, user.name
      FROM user
      INNER JOIN watchlist ON watchlist.user_id = user.id
      WHERE watchlist.is_active = 1
    `,
  ).all<DigestUser>();

  const handledDigestRunIds = new Set<string>();
  let digestsSent = 0;
  for (const user of usersResult.results ?? []) {
    try {
      digestsSent += await runDigestForUser(env, {
        user,
        cadence,
        periodStart: periodStartIso,
        periodEnd: periodEndIso,
        strategyGenerationDeadlineAt,
        handledDigestRunIds,
      });
    } catch (error) {
      // A single workspace must never abort other customers' scheduled work.
      console.error(
        `Digest run failed for user ${user.id}; continuing with remaining users.`,
        error,
      );
    }
  }

  digestsSent += await retryFailedDigests(env, {
    retryCandidates,
    handledDigestRunIds,
    strategyGenerationDeadlineAt,
  });
  return digestsSent;
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

  const watchlists = await listWatchlists(env, user.id);
  const eligibleByWatchlist: Array<{
    watchlist: WatchlistRecord;
    events: WatchEventRecord[];
  }> = [];
  for (const watchlist of watchlists) {
    const events = await listWatchEventsBetween(
      env,
      watchlist.id,
      periodStart,
      periodEnd,
    );
    eligibleByWatchlist.push({
      watchlist,
      events: events.filter(isCustomerDigestEligibleEvent),
    });
  }

  const adIds = eligibleByWatchlist.flatMap(({ events }) =>
    events.map((event) => event.adId).filter((adId): adId is string => Boolean(adId)),
  );
  const adsById = new Map(
    (await listAdsByIds(env, adIds)).map((ad) => [ad.metaAdId, ad]),
  );
  const digestItems: DigestSourceItem[] = [];
  for (const { watchlist, events } of eligibleByWatchlist) {
    for (const event of events) {
      const ad = event.adId ? adsById.get(event.adId) ?? null : null;
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
  if (!existingDigest && digestItems.length === 0) {
    const runStats = await getSuccessfulRunStatsForUserBetween(
      env,
      user.id,
      periodStart,
      periodEnd,
    );
    if (runStats.runs === 0) return 0;
    heartbeat = runStats;
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
    ...(initialStrategyLease
      ? {
          strategyGenerationStatus: DIGEST_STRATEGY_GENERATION_PENDING,
          strategyGenerationLeaseId: initialStrategyLease.leaseId,
          strategyGenerationLeaseExpiresAt: initialStrategyLease.leaseExpiresAt,
        }
      : {}),
  };
  const candidateItems = digestItems.map((item) => ({
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
        return 0;
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
      return 0;
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
        return 0;
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
        ...readDigestDeliveryCohortCounts(digestSummary, selectedDigestItems.length),
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
    if (runStats.runs === 0) return 0;
    heartbeat = runStats;
  }

  const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
  const delivery = await deliverWeeklyDigest(env, {
    heartbeat,
    userId: user.id,
    userName: user.name,
    accountEmail: user.email,
    digestRunId,
    periodStart,
    periodEnd,
    ...deliverySnapshot,
    cadence,
    lane: "customer",
  });
  return delivery.attempts > 0 ? 1 : 0;
}

async function retryFailedDigests(
  env: AppEnv,
  input: {
    retryCandidates: Awaited<ReturnType<typeof listRetryableDigestRuns>>;
    handledDigestRunIds: Set<string>;
    strategyGenerationDeadlineAt: number;
  },
) {
  let retried = 0;
  for (const candidate of input.retryCandidates) {
    if (input.handledDigestRunIds.has(candidate.id)) continue;
    try {
      const plan = await getUserPlan(env, candidate.userId);
      const cadence = digestCadenceForPeriod(candidate.periodStart, candidate.periodEnd);
      if (!PLAN_LIMITS[plan].digests || !planAllowsDigestCadence(plan, cadence)) continue;

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
        continue;
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
        if (runStats.runs === 0) continue;
        heartbeat = runStats;
      }

      const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
      const delivery = await deliverWeeklyDigest(env, {
        heartbeat,
        userId: candidate.userId,
        userName: candidate.userName,
        accountEmail: candidate.userEmail,
        digestRunId: candidate.id,
        periodStart: candidate.periodStart,
        periodEnd: candidate.periodEnd,
        ...buildPersistedDigestDeliverySnapshot(deliveryDigest),
        cadence,
        lane: "customer",
      });
      if (delivery.attempts > 0) retried += 1;
    } catch (error) {
      console.error(
        `Digest retry failed for digest run ${candidate.id}; continuing with remaining retries.`,
        error,
      );
    }
  }
  return retried;
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
    strategyParagraph: readDigestStrategyNote(digest.summary)?.paragraph ?? null,
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
    digest.items.every((item) => readDigestSourceEventId(item.metadata) !== null)
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
  return { totalEligibleEvents: total, includedEvents: included, omittedEvents: omitted };
}

function requireDigestSourceEventId(metadata: Record<string, unknown> | undefined) {
  const eventId = readDigestSourceEventId(metadata);
  if (!eventId) {
    throw new Error("Digest item is missing its original watch_event ID; retry is unsafe.");
  }
  return eventId;
}

function readDigestExpectedItemCount(summary?: Record<string, unknown>) {
	const hasCohortCounts =
		Object.prototype.hasOwnProperty.call(summary ?? {}, "totalEligibleEvents") ||
		Object.prototype.hasOwnProperty.call(summary ?? {}, "includedEvents") ||
		Object.prototype.hasOwnProperty.call(summary ?? {}, "omittedEvents");
	if (hasCohortCounts) {
		const total = readNonNegativeInteger(summary?.totalEligibleEvents);
		const included = readNonNegativeInteger(summary?.includedEvents);
		const omitted = readNonNegativeInteger(summary?.omittedEvents);
		return total !== null && included !== null && omitted !== null && total === included + omitted
			? included
			: null;
	}
  const expectedItemCount = summary?.totalEvents;
  return Number.isSafeInteger(expectedItemCount) && Number(expectedItemCount) >= 0
    ? Number(expectedItemCount)
    : null;
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function digestCadenceForPeriod(periodStart: string, periodEnd: string): DigestCadence {
  const spanMs = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
  return spanMs <= 36 * 60 * 60 * 1000 ? "daily" : "weekly";
}
