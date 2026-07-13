import { buildAnalysisFields } from "~/lib/analysis.server";
import { isAdLibraryBackedAd, mapAdSourceToAnalysisSource } from "~/lib/ad-source-kind";
import {
  type DigestCadence,
  digestMetadataForEvent,
} from "~/lib/change-intelligence";
import { captureCreativeText } from "~/lib/creative-text.server";
import { isCustomerDigestEligibleEvent } from "~/lib/delivery-policy.server";
import {
  createAdObservation,
  createEventCandidate,
  createDigestRun,
  createProofCapture,
  createWatchEvent,
  createWatchlistRun,
  clearDigestItems,
  countProofCapturesForWatchlistSince,
  countProofCapturesForWorkspaceSince,
  finishWatchlistRun,
  recordWatchlistCapacitySkip,
  getDigest,
  getDigestByPeriod,
  getRecentSuccessfulRuns,
  getOperatorRiskSummary,
  getSavedQuery,
  getSuccessfulRunStatsForUserBetween,
  countWatchlistRunsForUserSince,
  getWeeklyBusinessSummary,
  hasInFlightWatchlistRun,
  getUserDeliveryProfile,
  getWatchlist,
  hydrateAdsWithPersistedCreatives,
  listActiveWatchlists,
  listProofCapturesForTarget,
  listProofCapturesForTargets,
  listRecentWorkspaceProofCaptures,
  listRetryableDigestRuns,
  listRetryableInstantAttempts,
  listLastSuccessfulProofCapturesForAds,
  listObservationsForRun,
  listWatchEvents,
  listAdsByIds,
  listWatchEventsBetween,
  listWatchEventsByIds,
  listWatchlists,
  logMetaIntegrationStatus,
  touchWatchlistScanned,
  upsertProofTarget,
  upsertAd,
  addDigestItem,
} from "~/lib/data.server";
import type { AppEnv } from "~/lib/env.server";
import { captureLandingPageSnapshot } from "~/lib/landing-pages.server";
import { LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION } from "~/lib/landing-page-signals.server";
import {
  CommercialDiscoveryError,
  resolveCommercialDiscoveryProvider,
  searchAdsViaSourceResolver,
} from "~/lib/ad-source.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import { getUserPlan, PLAN_LIMITS } from "~/lib/plan.server";
import { planAllowsDigestCadence, shouldSchedulePlanInRegularScan } from "~/lib/plan-entitlements";
import {
  getEvidenceUsageSummary,
  isEvidenceUsageStorageUnavailableError,
  tryFinalizeEvidenceForProofCapture,
  tryReserveEvidenceForProofCapture,
} from "~/lib/evidence-usage.server";
import {
  buildCanonicalPageIdentity,
  buildProofTargetIdentity,
  evaluateProofPolicy,
  V1_PROOF_BUDGETS,
} from "~/lib/proof-policy.server";
import { normalizePublicHttpUrl } from "~/lib/public-url.server";
import type {
  AdRecord,
  NormalizedSavedQuery,
  ProofCaptureRecord,
  WatchEventType,
  WatchEventRecord,
  WatchlistRecord,
  WatchlistRunRecord,
} from "~/lib/types";
import {
  evaluateProofBackedEvents,
  scoreWatchEventImportance,
  selectLastSuccessfulProofCapture,
} from "~/lib/watch-event-evaluator.server";

const DEFAULT_PAGE_BUDGET = 2;
const MANUAL_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
const INACTIVE_MISS_THRESHOLD = 2;
const DAILY_DIGEST_LOOKBACK_DAYS = 1;
const WEEKLY_DIGEST_LOOKBACK_DAYS = 7;
const DIGEST_RETRY_WINDOW_DAYS = 7;
const DIGEST_RETRY_SWEEP_LIMIT = 25;
const DISCOVERY_WARMUP_QUERY_LIMIT = 5;
const DIRECT_WEBSITE_PROOF_INTERVAL_MS = 20 * 60 * 60 * 1000;

type ObservationRecord = Awaited<ReturnType<typeof listObservationsForRun>>[number];

interface WatchEventDraft {
  eventType: WatchEventType;
  adId: string | null;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
}

interface ScanPayload {
  ads: AdRecord[];
  pagesScanned: number;
  degraded: boolean;
}

interface ScanOptions {
  customerMetaAdLibraryToken?: string | null;
  existingRunId?: string;
  orchestrationToken?: string;
  concurrencyPermitToken?: string;
  orchestrationRunId?: string;
  forceLive?: boolean;
}

export type {
  MonitoringWorkflowParams,
} from "~/lib/monitoring-fanout.server";
export {
  buildWatchlistExecutionIdempotencyKey,
} from "~/lib/monitoring-fanout.server";
import type { MonitoringWorkflowParams } from "~/lib/monitoring-fanout.server";
import {
  buildWatchlistExecutionIdempotencyKey,
  claimOrchestratedWatchlistRun,
  collectMonitoringOrchestrationMetrics,
  finishOrchestratedWatchlistRun,
  hasOrchestratedRunBlockingInlineScan,
  isFanoutEnabledForWorkspace,
  isWatchlistEligibleForScheduledScan,
  markOrchestratedRunCancelled,
  markOrchestratedDispatchFailure,
  reconcileOrchestratedWatchlistRuns,
  renewMonitoringConcurrencySlot,
  renewOrchestratedWatchlistRunLease,
  resolveMonitoringFanoutMode,
  resolveMonitoringOrchestrationLeaseMs,
  scheduleWatchlistFanout,
} from "~/lib/monitoring-fanout.server";

interface RunScheduledMonitoringOptions {
  includeScans?: boolean;
  includeDigests?: boolean;
  cron?: string;
  digestCadence?: DigestCadence;
  digestLookbackDays?: number;
  scheduledTime?: number;
}

// Cloudflare kills scheduled invocations at the 15-minute wall limit. Stop
// starting new watchlist scans before that so the in-flight scan can finish
// and the kill never silently swallows work.
const SCHEDULED_MONITORING_TIME_BUDGET_MS = 12 * 60 * 1000;

interface RunWeeklyDigestsOptions {
  cadence?: DigestCadence;
  lookbackDays?: number;
  periodEnd?: number | string | Date;
}

export async function runScheduledMonitoring(
  env: AppEnv,
  options: RunScheduledMonitoringOptions = {},
) {
  if (!env.DB) {
    return {
      queued: 0,
      duplicates: 0,
      inlineRuns: 0,
      inlineFailures: 0,
      skippedForBudget: 0,
      skippedForBilling: 0,
      dispatchFailures: 0,
      digests: 0,
    };
  }

  const deadlineAt = Date.now() + SCHEDULED_MONITORING_TIME_BUDGET_MS;

  // Digests run BEFORE the scan loop. The digest period ends at the cron's
  // scheduled time, so it never depends on tonight's scan results — and a
  // runtime kill mid-scan can no longer wipe out the day's digests for every
  // user (a digest run that is never created is invisible to the retry sweep).
  const digests = options.includeDigests
    ? await runDigests(env, {
        cadence: options.digestCadence ?? "weekly",
        lookbackDays: options.digestLookbackDays,
        periodEnd: options.scheduledTime,
      })
    : 0;

  let queued = 0;
  let duplicates = 0;
  let inlineRuns = 0;
  let inlineFailures = 0;
  let skippedForBudget = 0;
  let skippedForBilling = 0;
  let dispatchFailures = 0;

  if (options.includeScans !== false) {
    const listedWatchlists = await listActiveWatchlists(env, {
      includeScout: shouldIncludeScoutInScheduledMonitoring(options),
    });
    const browserAccess = await filterScheduledBrowserWatchlists(env, listedWatchlists);
    const watchlists = browserAccess.watchlists;
    skippedForBilling = browserAccess.skipped;

    const fanoutMode = resolveMonitoringFanoutMode(env);
    const scheduledTime = options.scheduledTime ?? Date.now();

    if (fanoutMode === "inline") {
      const inlineResult = await runScheduledMonitoringInline(env, watchlists, deadlineAt, {
        scheduledTime,
        cron: options.cron,
      });
      inlineRuns = inlineResult.inlineRuns;
      inlineFailures = inlineResult.inlineFailures;
      skippedForBudget = inlineResult.skippedForBudget;
    } else {
      await reconcileOrchestratedWatchlistRuns(env, {
        scheduledTime,
        cron: options.cron,
        mode: fanoutMode,
        leaseMs: resolveMonitoringOrchestrationLeaseMs(env),
      });

      const fanoutWatchlists = watchlists.filter((watchlist) =>
        isFanoutEnabledForWorkspace(env, watchlist.userId),
      );
      const inlineFallbackWatchlists = watchlists.filter(
        (watchlist) => !isFanoutEnabledForWorkspace(env, watchlist.userId),
      );

      const fanoutResult = fanoutWatchlists.length > 0
        ? await scheduleWatchlistFanout(env, {
            watchlists: fanoutWatchlists,
            scheduledTime,
            cron: options.cron,
            mode: fanoutMode,
          })
        : {
            eligible: 0,
            queued: 0,
            duplicates: 0,
            dispatchFailures: 0,
            shadowOnly: 0,
            inlineFallback: false,
          };
      queued = fanoutResult.queued;
      duplicates = fanoutResult.duplicates;
      dispatchFailures = fanoutResult.dispatchFailures;

      if (inlineFallbackWatchlists.length > 0) {
        const inlineResult = await runScheduledMonitoringInline(
          env,
          inlineFallbackWatchlists,
          deadlineAt,
          {
            scheduledTime,
            cron: options.cron,
          },
        );
        inlineRuns = inlineResult.inlineRuns;
        inlineFailures += inlineResult.inlineFailures;
        skippedForBudget += inlineResult.skippedForBudget;
      }

      const metrics = await collectMonitoringOrchestrationMetrics(env);
      const { logAppEvent } = await import("~/lib/log.server");
      logAppEvent("info", "monitoring_fanout_scheduled", "Scheduled monitoring fan-out", {
        details: {
        cron: options.cron ?? null,
        mode: fanoutMode,
        eligible: fanoutResult.eligible,
        queued: fanoutResult.queued,
        duplicates: fanoutResult.duplicates,
        dispatchFailures: fanoutResult.dispatchFailures,
        skippedForBilling,
        shadowOnly: fanoutResult.shadowOnly,
        running: metrics.running,
        oldestQueuedAgeMs: metrics.oldestQueuedAgeMs,
        },
      });

      if (fanoutResult.dispatchFailures > 0) {
        console.error(
          `Scheduled monitoring could not dispatch ${fanoutResult.dispatchFailures} watchlist job(s); reconciliation will retry.`,
        );
      }
    }

    if (skippedForBudget > 0 && fanoutMode === "inline") {
      console.error(
        `Scheduled monitoring hit its time budget with ${skippedForBudget} of ${watchlists.length} watchlists left unchecked; review volume must be expanded before more watchlists are added.`,
      );
    }
  }

  return {
    queued,
    duplicates,
    inlineRuns,
    inlineFailures,
    skippedForBudget,
    skippedForBilling,
    dispatchFailures,
    digests,
  };
}

async function filterScheduledBrowserWatchlists(env: AppEnv, watchlists: WatchlistRecord[]) {
  const eligible: WatchlistRecord[] = [];
  let skipped = 0;

  for (const watchlist of watchlists) {
    const access = await isWatchlistEligibleForScheduledScan(env, watchlist);
    if (access.eligible) {
      eligible.push(watchlist);
    } else {
      skipped += 1;
    }
  }

  return { watchlists: eligible, skipped };
}

const INSTANT_ALERT_FLUSH_LOOKBACK_HOURS = 48;
const INSTANT_ALERT_FLUSH_LIMIT = 50;

// Quiet-hours deferral records a skipped attempt but nothing ever sent it
// once the window ended, and a transient provider failure lost the alert
// forever. This pass (hosted on the six-hourly warmup cron) re-runs delivery
// for those events; the attempt-kind idempotency keys make re-delivery safe —
// already-sent batches dedupe, still-quiet batches stay deferred.
export async function flushDeferredInstantAlerts(env: AppEnv) {
  if (!env.DB) {
    return { groups: 0, attempts: 0 };
  }

  const since = new Date(
    Date.now() - INSTANT_ALERT_FLUSH_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const pending = await listRetryableInstantAttempts(env, {
    since,
    limit: INSTANT_ALERT_FLUSH_LIMIT,
  });

  const groups = new Map<string, Set<string>>();
  for (const attempt of pending) {
    if (!attempt.watchlistId) {
      continue;
    }
    const eventIds = groups.get(attempt.watchlistId) ?? new Set<string>();
    for (const eventId of attempt.eventIds) {
      eventIds.add(eventId);
    }
    groups.set(attempt.watchlistId, eventIds);
  }

  let flushedGroups = 0;
  let attempts = 0;

  for (const [watchlistId, eventIds] of groups) {
    try {
      const watchlist = await getWatchlist(env, watchlistId);
      if (!watchlist || !watchlist.isActive) {
        continue;
      }

      const events = await listWatchEventsByIds(env, watchlistId, [...eventIds]);
      if (events.length === 0) {
        continue;
      }

      const profile = await getUserDeliveryProfile(env, watchlist.userId);
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
      const delivery = await deliverWatchlistAlerts(env, {
        userId: watchlist.userId,
        userName: profile?.name ?? watchlist.name,
        accountEmail: profile?.email ?? null,
        watchlist,
        events,
        lane: "customer",
      });

      flushedGroups += 1;
      attempts += delivery.attempts;
    } catch (error) {
      console.error(
        `Instant alert flush failed for watchlist ${watchlistId}; continuing with remaining watchlists.`,
        error,
      );
    }
  }

  return { groups: flushedGroups, attempts };
}

// Runs after scheduled monitoring: when paying customers' scans or
// deliveries are degrading, the operator hears about it instead of finding
// out from a churn email.
export function buildWeeklyBusinessLines(
  summary: Awaited<ReturnType<typeof getWeeklyBusinessSummary>>,
) {
  const paying =
    summary.payingByPlan.length > 0
      ? summary.payingByPlan.map((entry) => `${entry.plan}: ${entry.count}`).join(", ")
      : "none yet";
  const digestRate =
    summary.digestAttempts7d > 0
      ? `${Math.round((summary.digestSent7d / summary.digestAttempts7d) * 100)}% (${summary.digestSent7d}/${summary.digestAttempts7d})`
      : "no digests sent";

  return [
    `Signups (7d): ${summary.signups7d} — activated onboarding: ${summary.activated7d}`,
    `Paying customers: ${paying}`,
    `Dunning (payment trouble, plan kept): ${summary.dunningCount}`,
    `Dropped to free (7d, had billing history): ${summary.revokedToFree7d}`,
    `Digest delivery success (7d): ${digestRate}`,
    `Oldest active paid-watchlist scan: ${summary.oldestActivePaidScanAt ?? "n/a"}`,
  ];
}

export async function sendWeeklyBusinessNumbers(env: AppEnv) {
  if (!env.DB) {
    return { sent: false, reason: "no_db" };
  }

  const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
  const summary = await getWeeklyBusinessSummary(env);
  const weekStamp = new Date().toISOString().slice(0, 10);
  const sent = await sendOperatorAlertEmail(env, {
    subject: "Five to Nine — weekly business numbers",
    lines: buildWeeklyBusinessLines(summary),
    idempotencyKey: `business-weekly:${weekStamp}`,
  });

  return { sent };
}

export async function sendCustomerAtRiskAlert(
  env: AppEnv,
  options: { skippedForBudget?: number; dispatchFailures?: number; idempotencyKey?: string } = {},
) {
  if (!env.DB) {
    return { sent: false, reason: "no_db" };
  }

  const summary = await getOperatorRiskSummary(env);
  const lines: string[] = [];

  if ((options.skippedForBudget ?? 0) > 0) {
    lines.push(
      `${options.skippedForBudget} watchlist(s) were SKIPPED in a recent scheduled scan window because the check window filled — review volume must be expanded before adding more watchlists (revive the Workflow path).`,
    );
  }
  if ((options.dispatchFailures ?? 0) > 0) {
    lines.push(
      `${options.dispatchFailures} watchlist fan-out job(s) failed to dispatch in a recent scheduled scan window; reconciliation will retry, but the Workflow dispatch path needs attention.`,
    );
  }

  for (const watchlist of summary.staleWatchlists) {
    lines.push(
      `Watchlist "${watchlist.name}" (${watchlist.userEmail}) has not been scanned since ${watchlist.lastScannedAt ?? "creation"} — likely budget-skipped or cron trouble.`,
    );
  }

  for (const watchlist of summary.troubleWatchlists) {
    lines.push(
      `Watchlist "${watchlist.name}" (${watchlist.userEmail}) has failed ${watchlist.consecutiveFailures} scans in a row.`,
    );
  }
  if (summary.deliveryFailures24h > 0) {
    lines.push(`${summary.deliveryFailures24h} customer delivery attempt(s) failed in the last 24h.`);
  }
  if (summary.stuckRuns > 0) {
    lines.push(`${summary.stuckRuns} watchlist run(s) look stuck (pending/running for over an hour).`);
  }

  if (lines.length === 0) {
    return { sent: false, reason: "all_clear" };
  }

  const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
  const sent = await sendOperatorAlertEmail(env, {
    subject: `0509 customer-at-risk: ${lines.length} signal${lines.length === 1 ? "" : "s"}`,
    lines,
    idempotencyKey: options.idempotencyKey,
  });

  return { sent, signals: lines.length };
}

export async function runScheduledDiscoveryWarmup(env: AppEnv) {
  if (!env.DB) {
    return {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };
  }

  const watchlists = await listActiveWatchlists(env);
  const seenFingerprints = new Set<string>();
  const warmupTargets: Array<{
    watchlist: WatchlistRecord;
    query: NormalizedSavedQuery;
  }> = [];
  let skipped = 0;

  const sortedWatchlists = [...watchlists].sort((left, right) => {
    const leftTs = left.lastScannedAt ? new Date(left.lastScannedAt).getTime() : 0;
    const rightTs = right.lastScannedAt ? new Date(right.lastScannedAt).getTime() : 0;
    return leftTs - rightTs;
  });

  for (const watchlist of sortedWatchlists) {
    const access = await isWatchlistEligibleForScheduledScan(env, watchlist);
    if (!access.eligible) {
      skipped += 1;
      continue;
    }

    if (warmupTargets.length >= DISCOVERY_WARMUP_QUERY_LIMIT) {
      skipped += 1;
      continue;
    }

    if (seenFingerprints.has(watchlist.targetFingerprint)) {
      skipped += 1;
      continue;
    }

    const query = await resolveWatchlistQuery(env, watchlist);
    if (!query) {
      skipped += 1;
      continue;
    }

    seenFingerprints.add(watchlist.targetFingerprint);
    warmupTargets.push({ watchlist, query });
  }

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const target of warmupTargets) {
    attempted += 1;

    try {
      const response = await searchAdsViaSourceResolver(env, target.query, null, {
        purpose: "scheduled_warmup",
      });
      if (response.discoveryStatus === "cache_only" || response.cacheStatus === "stale") {
        skipped += 1;
        continue;
      }

      succeeded += 1;
    } catch (error) {
      failed += 1;

      if (error instanceof CommercialDiscoveryError) {
        continue;
      }

      throw error;
    }
  }

  return {
    attempted,
    succeeded,
    failed,
    skipped,
  };
}

// First scan on creation: a new watchlist must show value within minutes,
// not after the next scheduled cron. Runs in the background; a failure is
// non-fatal because the scheduled scan still covers the watchlist.
//
// Free accounts keep their activation scan (their scheduled cadence is
// "none", so this is the only scan they get), but a per-account daily cap
// stops a pause/recreate loop from turning watchlist creation into
// unmetered Browser Rendering usage. Paid plans are uncapped here.
const FREE_FIRST_SCAN_DAILY_CAP = 3;

export function queueFirstWatchlistScan(
  env: AppEnv,
  ctx: ExecutionContext | undefined,
  watchlist: WatchlistRecord | null | undefined,
) {
  if (!ctx || !watchlist || watchlist.lastScannedAt) {
    return false;
  }

  ctx.waitUntil(
    runFirstWatchlistScanWithPlanCap(env, watchlist).catch((error) => {
      console.error(
        `First scan failed for watchlist ${watchlist.id}; the scheduled scan will retry.`,
        error,
      );
    }),
  );

  return true;
}

async function runFirstWatchlistScanWithPlanCap(env: AppEnv, watchlist: WatchlistRecord) {
  const { getUserPlan } = await import("~/lib/plan.server");
  const plan = await getUserPlan(env, watchlist.userId);
  if (plan === "free") {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentRuns = await countWatchlistRunsForUserSince(env, watchlist.userId, since);
    if (recentRuns >= FREE_FIRST_SCAN_DAILY_CAP) {
      console.warn(
        `First scan skipped for watchlist ${watchlist.id}: free-plan daily first-scan cap reached.`,
      );
      return;
    }
  }
  await runWatchlistManual(env, watchlist);
}

export async function runWatchlistManual(env: AppEnv, watchlist: WatchlistRecord) {
  if (
    watchlist.lastScannedAt &&
    Date.now() - new Date(watchlist.lastScannedAt).getTime() < MANUAL_REFRESH_COOLDOWN_MS
  ) {
    throw new Error("This watchlist was refreshed recently. Try again in a few minutes.");
  }

  const customerMetaAdLibraryToken = await resolveWatchlistCustomerMetaAdLibraryToken(env, watchlist);

  return runWatchlist(
    env,
    watchlist,
    "manual",
    async () => {
      const query = await resolveWatchlistQuery(env, watchlist);
      if (!query) {
        throw new Error("The watchlist target could not be resolved.");
      }
      return performBoundedScan(env, query, DEFAULT_PAGE_BUDGET, {
        customerMetaAdLibraryToken,
      });
    },
    {
      customerMetaAdLibraryToken,
    },
  );
}

export async function runWatchlistWorkflowJob(
  env: AppEnv,
  params: MonitoringWorkflowParams,
  options: {
    concurrencyPermitToken?: string;
  } = {},
) {
  const preflight = await preflightWatchlistWorkflowJob(env, params);
  if (preflight.status !== "ready") {
    return preflight;
  }

  const claim = await claimOrchestratedWatchlistRun(env, {
    runId: params.runId,
    leaseMs: resolveMonitoringOrchestrationLeaseMs(env),
  });
  if (!claim.claimed) {
    return {
      status: "duplicate" as const,
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
      runId: params.runId,
    };
  }

  const fanoutMode = resolveMonitoringFanoutMode(env);
  if (fanoutMode === "inline") {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: "fanout_disabled",
      message: "Scheduled fan-out was disabled before this scan could run.",
    });
    return {
      status: "cancelled" as const,
      reason: "fanout_disabled",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
      runId: params.runId,
    };
  }
  if (fanoutMode === "shadow") {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: "fanout_disabled",
      message: "Scheduled fan-out was disabled before this scan could run.",
    });
    return {
      status: "cancelled" as const,
      reason: "fanout_disabled",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
      runId: params.runId,
    };
  }

  const watchlist = await getWatchlist(env, params.watchlistId);
  if (!watchlist || !watchlist.isActive) {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: "watchlist_unavailable",
      message: "This competitor is no longer being tracked.",
    });
    return {
      status: "skipped" as const,
      reason: "watchlist_unavailable",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  if (!isFanoutEnabledForWorkspace(env, watchlist.userId)) {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: "workspace_not_allowlisted",
      message: "Scheduled fan-out is not enabled for this workspace.",
    });
    return {
      status: "skipped" as const,
      reason: "workspace_not_allowlisted",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  const access = await isWatchlistEligibleForScheduledScan(env, watchlist);
  if (!access.eligible) {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: access.reason,
      message: "Scheduled scans paused for this workspace.",
    });
    return {
      status: "skipped" as const,
      reason: access.reason,
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  const query = await resolveWatchlistQuery(env, watchlist);
  if (!query) {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: "watchlist_target_unresolved",
      message: "This competitor could not be resolved for scanning.",
    });
    return {
      status: "skipped" as const,
      reason: "watchlist_target_unresolved",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  const customerMetaAdLibraryToken = await resolveWatchlistCustomerMetaAdLibraryToken(env, watchlist);
  if (options.concurrencyPermitToken) {
    await renewMonitoringConcurrencySlot(env, { token: options.concurrencyPermitToken });
  }
  await renewOrchestratedWatchlistRunLease(env, {
    runId: params.runId,
    processingToken: claim.processingToken,
  });
  try {
    const result = await runWatchlist(
      env,
      watchlist,
      params.triggerType,
      () =>
        performBoundedScan(env, query, DEFAULT_PAGE_BUDGET, {
          customerMetaAdLibraryToken,
          orchestrationRunId: params.runId,
          orchestrationToken: claim.processingToken,
          concurrencyPermitToken: options.concurrencyPermitToken,
          forceLive: true,
        }),
      {
        customerMetaAdLibraryToken,
        existingRunId: params.runId,
        orchestrationToken: claim.processingToken,
        concurrencyPermitToken: options.concurrencyPermitToken,
      },
    );

    return {
      status: "completed" as const,
      executionKey: params.executionKey,
      proofCaptureRequestKeyPrefix: params.proofCaptureRequestKeyPrefix,
      ...result,
    };
  } catch (error) {
    if (isRetryableMonitoringFailure(error)) {
      await markOrchestratedDispatchFailure(env, {
        runId: params.runId,
        errorCode: "retryable_scan_failure",
        errorMessage: error instanceof Error ? error.message : "Retryable scan failure.",
        retryAfterIso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
    }
    throw error;
  }
}

export async function preflightWatchlistWorkflowJob(env: AppEnv, params: MonitoringWorkflowParams) {
  const fanoutMode = resolveMonitoringFanoutMode(env);
  if (fanoutMode === "inline") {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: "fanout_disabled",
      message: "Scheduled fan-out was disabled before this scan could run.",
    });
    return {
      status: "cancelled" as const,
      reason: "fanout_disabled",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
      runId: params.runId,
    };
  }
  if (fanoutMode === "shadow") {
    return {
      status: "shadow" as const,
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
      runId: params.runId,
    };
  }

  const watchlist = await getWatchlist(env, params.watchlistId);
  if (!watchlist || !watchlist.isActive) {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: "watchlist_unavailable",
      message: "This competitor is no longer being tracked.",
    });
    return {
      status: "skipped" as const,
      reason: "watchlist_unavailable",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  if (!isFanoutEnabledForWorkspace(env, watchlist.userId)) {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: "workspace_not_allowlisted",
      message: "Scheduled fan-out is not enabled for this workspace.",
    });
    return {
      status: "skipped" as const,
      reason: "workspace_not_allowlisted",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  const access = await isWatchlistEligibleForScheduledScan(env, watchlist);
  if (!access.eligible) {
    await markOrchestratedRunCancelled(env, {
      runId: params.runId,
      reason: access.reason,
      message: "Scheduled scans paused for this workspace.",
    });
    return {
      status: "skipped" as const,
      reason: access.reason,
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  return {
    status: "ready" as const,
    watchlistId: params.watchlistId,
    executionKey: params.executionKey,
    runId: params.runId,
  };
}

async function completeWatchlistRun(
  env: AppEnv,
  runId: string,
  input: {
    status: WatchlistRunRecord["status"];
    pagesScanned: number;
    summary: Record<string, unknown>;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
  options: ScanOptions,
) {
  if (options.orchestrationToken) {
    const finalized = await finishOrchestratedWatchlistRun(env, {
      runId,
      processingToken: options.orchestrationToken,
      status: input.status,
      pagesScanned: input.pagesScanned,
      summary: input.summary,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });
    if (!finalized) {
      throw new Error("Stale orchestrated watchlist run token; refusing to finalize.");
    }
    return;
  }

  await finishWatchlistRun(env, runId, input);
}

function isRetryableMonitoringFailure(error: unknown) {
  if (error instanceof CommercialDiscoveryError) {
    return error.failureClass === "rate_limited" || error.failureClass === "browser_launch_failed";
  }
  if (error instanceof Error) {
    return /timeout|throttl|temporar|network|concurrency_limited/i.test(error.message);
  }
  return false;
}

export async function runWatchlist(
  env: AppEnv,
  watchlist: WatchlistRecord,
  triggerType: WatchlistRunRecord["triggerType"],
  // Lazy: the scan must not start until the in-flight guard below has
  // cleared, or a blocked duplicate still burns a Browser Rendering session.
  scan: () => Promise<ScanPayload>,
  options: ScanOptions = {},
) {
  // One scan at a time per watchlist: the first-scan waitUntil, an eager
  // "Refresh now" click, and the regular cron can otherwise overlap — double
  // Browser Rendering spend and duplicate baseline events.
  if (!options.existingRunId) {
    const inFlightCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    if (await hasInFlightWatchlistRun(env, watchlist.id, inFlightCutoff)) {
      throw new Error(
        "A scan for this watchlist is already running. Fresh results land in a couple of minutes.",
      );
    }
  }

  const recentRuns = await getRecentSuccessfulRuns(env, watchlist.id, 3);
  const baselineRun = recentRuns[0] ?? null;
  const priorRun = recentRuns[1] ?? null;
  const runId =
    options.existingRunId ??
    (await createWatchlistRun(
      env,
      watchlist.id,
      triggerType,
      baselineRun?.id ?? null,
      DEFAULT_PAGE_BUDGET,
    ));

  try {
    const { ads, pagesScanned, degraded } = await scan();

    if (degraded) {
      // Stale-cache honesty: nothing live was fetched, so no diff runs, the
      // run is recorded as failed (cache_only), lastScannedAt stays put, and
      // integration status reflects reality. The catch path still attempts
      // direct-website proof, and the next scan retries live.
      throw new CommercialDiscoveryError(
        "Live discovery was cooling down; only cached results were available, so change detection was skipped.",
        "rate_limited",
      );
    }

    await persistCheapScanObservations(env, runId, ads);

    const [currentObservations, baselineObservations, priorObservations] = await Promise.all([
      listObservationsForRun(env, runId),
      baselineRun ? listObservationsForRun(env, baselineRun.id) : Promise.resolve([]),
      priorRun ? listObservationsForRun(env, priorRun.id) : Promise.resolve([]),
    ]);

    const eventDrafts = buildScanNativeEventDrafts(
      watchlist,
      currentObservations,
      baselineObservations,
      priorObservations,
      baselineRun !== null,
    );

    const recentWatchEvents = await listWatchEvents(env, watchlist.id, 80);
    const scanNativeEvents = await persistScanNativeEvents(
      env,
      watchlist.id,
      runId,
      baselineRun?.id ?? null,
      eventDrafts,
    );
    const proofEvaluation = await evaluateSelectiveProofCandidates(env, {
      watchlist,
      runId,
      currentObservations,
      scanNativeDrafts: eventDrafts,
      recentWatchEvents,
    });
    const directWebsiteProofEvaluation = await evaluateDirectWebsiteProofCandidate(env, {
      watchlist,
      runId,
      recentWatchEvents: [...recentWatchEvents, ...proofEvaluation.events],
      watchlistRunAttemptCount: proofEvaluation.proofAttemptCount,
    });
    const allEvents = [
      ...scanNativeEvents,
      ...proofEvaluation.events,
      ...directWebsiteProofEvaluation.events,
    ];
    const userDeliveryProfile = await getUserDeliveryProfile(env, watchlist.userId);
    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
    const alertDelivery =
      allEvents.length > 0
        ? await deliverWatchlistAlerts(env, {
            userId: watchlist.userId,
            userName: userDeliveryProfile?.name ?? watchlist.name,
            accountEmail: userDeliveryProfile?.email ?? null,
            watchlist,
            events: allEvents,
            lane: "customer",
          })
        : { attempts: 0, channels: [] };

    await completeWatchlistRun(
      env,
      runId,
      {
        status: "succeeded",
        pagesScanned,
        summary: {
          adsSeen: currentObservations.length,
          websiteProofUrl: directWebsiteProofEvaluation.websiteUrl,
          candidatesDetected:
            eventDrafts.length + proofEvaluation.candidateCount + directWebsiteProofEvaluation.candidateCount,
          proofsAttempted: proofEvaluation.proofAttemptCount + directWebsiteProofEvaluation.proofAttemptCount,
          eventsConfirmed:
            scanNativeEvents.length +
            proofEvaluation.confirmedEventCount +
            directWebsiteProofEvaluation.confirmedEventCount,
          sendsTriggered: alertDelivery.attempts,
          events: allEvents.length,
          eventTypes: summarizeEventTypes(allEvents),
        },
      },
      options,
    );
    await touchWatchlistScanned(env, watchlist.id);
    const commercialProvider = resolveCommercialDiscoveryProvider(env, {
      customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
    });
    await logMetaIntegrationStatus(env, {
      status:
        commercialProvider === "meta_library_browser"
          ? "healthy"
          : commercialProvider === "meta_api"
            ? "degraded"
            : "demo",
      summary:
        commercialProvider === "meta_library_browser"
          ? "Scheduled watchlist scan completed through the commercial discovery resolver."
          : commercialProvider === "meta_api"
            ? "Scheduled watchlist scan completed with the diagnostic Meta API path."
            : "Watchlist scan completed in explicit demo mode because no live commercial provider is configured.",
      metadata: {
        watchlistId: watchlist.id,
        runId,
      },
    });

    return { runId, events: allEvents.length };
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown monitoring error.";
    const errorCode =
      error instanceof CommercialDiscoveryError
        ? error.failureClass
        : "monitoring_failed";
    const directWebsiteUrl = directWebsiteUrlForWatchlist(watchlist);

    if (directWebsiteUrl) {
      const directWebsiteProofEvaluation = await evaluateDirectWebsiteProofCandidate(env, {
        watchlist,
        runId,
        recentWatchEvents: await listWatchEvents(env, watchlist.id, 80),
        watchlistRunAttemptCount: 0,
      });
      if (!directWebsiteProofEvaluation.proofCaptureSucceeded) {
        await completeWatchlistRun(
          env,
          runId,
          {
            status: "failed",
            pagesScanned: 0,
            summary: {
              adsSeen: 0,
              websiteProofUrl: directWebsiteProofEvaluation.websiteUrl,
              candidatesDetected: directWebsiteProofEvaluation.candidateCount,
              proofsAttempted: directWebsiteProofEvaluation.proofAttemptCount,
              eventsConfirmed: directWebsiteProofEvaluation.confirmedEventCount,
              sendsTriggered: 0,
              events: directWebsiteProofEvaluation.events.length,
              eventTypes: summarizeEventTypes(directWebsiteProofEvaluation.events),
              scanStatus: "failed",
              scanErrorCode: errorCode,
              scanErrorMessage: details,
            },
            errorCode,
            errorMessage: details,
          },
          options,
        );
        await logMetaIntegrationStatus(env, {
          status: "degraded",
          summary: "Commercial discovery failed and direct website evidence did not complete.",
          errorCode,
          errorMessage: details,
          metadata: {
            watchlistId: watchlist.id,
            runId,
            websiteProofUrl: directWebsiteProofEvaluation.websiteUrl,
            proofAttemptCount: directWebsiteProofEvaluation.proofAttemptCount,
          },
        });

        return { runId, events: 0 };
      }

      const userDeliveryProfile = await getUserDeliveryProfile(env, watchlist.userId);
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
      const alertDelivery =
        directWebsiteProofEvaluation.events.length > 0
          ? await deliverWatchlistAlerts(env, {
              userId: watchlist.userId,
              userName: userDeliveryProfile?.name ?? watchlist.name,
              accountEmail: userDeliveryProfile?.email ?? null,
              watchlist,
              events: directWebsiteProofEvaluation.events,
              lane: "customer",
            })
          : { attempts: 0, channels: [] };

      await completeWatchlistRun(
        env,
        runId,
        {
          status: "succeeded",
          pagesScanned: 0,
          summary: {
            adsSeen: 0,
            websiteProofUrl: directWebsiteProofEvaluation.websiteUrl,
            candidatesDetected: directWebsiteProofEvaluation.candidateCount,
            proofsAttempted: directWebsiteProofEvaluation.proofAttemptCount,
            eventsConfirmed: directWebsiteProofEvaluation.confirmedEventCount,
            sendsTriggered: alertDelivery.attempts,
            events: directWebsiteProofEvaluation.events.length,
            eventTypes: summarizeEventTypes(directWebsiteProofEvaluation.events),
            scanStatus: "degraded",
            scanErrorCode: errorCode,
            scanErrorMessage: details,
          },
        },
        options,
      );
      await touchWatchlistScanned(env, watchlist.id);
      await logMetaIntegrationStatus(env, {
        status: "degraded",
        summary: "Commercial discovery failed, but direct website evidence still completed.",
        errorCode,
        errorMessage: details,
        metadata: {
          watchlistId: watchlist.id,
          runId,
          websiteProofUrl: directWebsiteProofEvaluation.websiteUrl,
        },
      });

      return { runId, events: directWebsiteProofEvaluation.events.length };
    }

    await completeWatchlistRun(
      env,
      runId,
      {
        status: "failed",
        pagesScanned: 0,
        summary: {
          adsSeen: 0,
          events: 0,
        },
        errorCode,
        errorMessage: details,
      },
      options,
    );
    await logMetaIntegrationStatus(env, {
      status: "degraded",
      summary:
        error instanceof CommercialDiscoveryError
          ? "Commercial discovery failed during monitoring."
          : "A monitoring run failed and needs attention.",
      errorCode,
      errorMessage: details,
      metadata: {
        watchlistId: watchlist.id,
        runId,
      },
    });
    throw error;
  }
}

export function diffWatchlistObservations(
  watchlist: WatchlistRecord,
  current: ObservationRecord[],
  baseline: ObservationRecord[],
  prior: ObservationRecord[],
) {
  const drafts: WatchEventDraft[] = [];
  const currentByAd = mapObservationsByAdId(current);
  const baselineByAd = mapObservationsByAdId(baseline);
  const priorByAd = mapObservationsByAdId(prior);

  for (const [adId, observation] of currentByAd) {
    const baselineObservation = baselineByAd.get(adId);

    if (!baselineObservation) {
      drafts.push({
        eventType: "ad_new",
        adId,
        title: "New ad detected",
        summary: `A new ad entered ${watchlist.name}.`,
        metadata: {
          advertiser: observation.metadata_json ? safeMetadata(observation).advertiser : null,
        },
      });
      continue;
    }

    if (
      observation.landing_page_url &&
      baselineObservation.landing_page_url &&
      // Compare canonical page identities, not raw strings: rotating
      // utm_/fbclid tracking params made the highest-severity event in the
      // system fire repeatedly on two visually identical URLs.
      (buildCanonicalPageIdentity(observation.landing_page_url) ??
        observation.landing_page_url) !==
        (buildCanonicalPageIdentity(baselineObservation.landing_page_url) ??
          baselineObservation.landing_page_url)
    ) {
      drafts.push({
        eventType: "landing_page_url_changed",
        adId,
        title: "Landing page URL changed",
        summary: "The destination URL changed between watchlist scans.",
        metadata: {
          from: baselineObservation.landing_page_url,
          to: observation.landing_page_url,
        },
      });
    }
  }

  for (const [adId] of priorByAd) {
    const seenInBaseline = baselineByAd.has(adId);
    const seenNow = currentByAd.has(adId);

    if (!seenInBaseline && !seenNow) {
      drafts.push({
        eventType: "ad_inactive",
        adId,
        title: "Ad marked inactive",
        summary: `The ad has been absent for ${INACTIVE_MISS_THRESHOLD} consecutive runs.`,
        metadata: {
          threshold: INACTIVE_MISS_THRESHOLD,
        },
      });
    }
  }

  return dedupeEventDrafts(drafts);
}

export async function runWeeklyDigests(
  env: AppEnv,
  options: RunWeeklyDigestsOptions = {},
) {
  return runDigests(env, {
    ...options,
    cadence: "weekly",
    lookbackDays: options.lookbackDays ?? WEEKLY_DIGEST_LOOKBACK_DAYS,
  });
}

export async function runDailyDigests(
  env: AppEnv,
  options: Omit<RunWeeklyDigestsOptions, "cadence"> = {},
) {
  return runDigests(env, {
    ...options,
    cadence: "daily",
    lookbackDays: options.lookbackDays ?? DAILY_DIGEST_LOOKBACK_DAYS,
  });
}

async function runDigests(
  env: AppEnv,
  options: RunWeeklyDigestsOptions = {},
) {
  if (!env.DB) {
    return 0;
  }

  const db = env.DB;
  const cadence = options.cadence ?? "weekly";
  const lookbackDays = options.lookbackDays ?? (
    cadence === "daily" ? DAILY_DIGEST_LOOKBACK_DAYS : WEEKLY_DIGEST_LOOKBACK_DAYS
  );
  const periodEnd =
    options.periodEnd === undefined ? new Date() : new Date(options.periodEnd);
  const periodStart = new Date(periodEnd.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const periodStartIso = periodStart.toISOString();
  const periodEndIso = periodEnd.toISOString();

  // Collect retry candidates BEFORE creating this tick's digest runs so the
  // sweep can never race the current period's deliveries.
  const retryCandidates = await listRetryableDigestRuns(env, {
    since: new Date(
      periodEnd.getTime() - DIGEST_RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    limit: DIGEST_RETRY_SWEEP_LIMIT,
  });

  const usersResult = await db
    .prepare(
      `
        SELECT DISTINCT user.id, user.email, user.name
        FROM user
        INNER JOIN watchlist ON watchlist.user_id = user.id
        WHERE watchlist.is_active = 1
      `,
    )
    .all<{ id: string; email: string; name: string }>();

  const users = usersResult.results ?? [];
  let digestsSent = 0;
  const handledDigestRunIds = new Set<string>();

  for (const user of users) {
    try {
      const plan = await getUserPlan(env, user.id);
      if (!PLAN_LIMITS[plan].digests || !planAllowsDigestCadence(plan, cadence)) {
        continue;
      }

      const watchlists = await listWatchlists(env, user.id);
      const digestItems: Array<{
        eventId: string;
        watchlistId: string;
        watchlistName: string;
        eventType: WatchEventType;
        title: string;
        summary: string;
        metadata: Record<string, unknown>;
      }> = [];

      const eligibleByWatchlist: Array<{
        watchlist: WatchlistRecord;
        events: WatchEventRecord[];
      }> = [];

      for (const watchlist of watchlists) {
        const events = await listWatchEventsBetween(
          env,
          watchlist.id,
          periodStartIso,
          periodEndIso,
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
            metadata: digestMetadataForEvent(event, undefined, ad),
          });
        }
      }

      // Zero changes is still a result the customer pays for. If we scanned
      // successfully this period, send an "all quiet" heartbeat instead of
      // going silent — silence is indistinguishable from a dead product.
      let heartbeat: { runs: number; watchlistsChecked: number; adsSeen: number } | null = null;
      if (digestItems.length === 0) {
        const runStats = await getSuccessfulRunStatsForUserBetween(
          env,
          user.id,
          periodStartIso,
          periodEndIso,
        );
        if (runStats.runs === 0) {
          // Nothing scanned either — there is nothing honest to report.
          continue;
        }
        heartbeat = runStats;
      }

      const existingDigest = await getDigestByPeriod(env, user.id, periodStartIso, periodEndIso);
      if (existingDigest?.delivery?.status === "sent") {
        continue;
      }

      const digestRunId =
        existingDigest?.id ??
        (await createDigestRun(env, user.id, periodStartIso, periodEndIso, {
          totalEvents: digestItems.length,
          watchlists: watchlists.length,
        }));
      handledDigestRunIds.add(digestRunId);

      if (existingDigest) {
        await clearDigestItems(env, digestRunId);
      }

      for (const item of digestItems) {
        await addDigestItem(env, digestRunId, {
          watchlistId: item.watchlistId,
          watchlistName: item.watchlistName,
          eventType: item.eventType,
          title: item.title,
          summary: item.summary,
          metadata: item.metadata,
        });
      }

      const { deliverWeeklyDigest } = await import("~/lib/delivery.server");
      const delivery = await deliverWeeklyDigest(env, {
        heartbeat,
        userId: user.id,
        userName: user.name,
        accountEmail: user.email,
        digestRunId,
        periodStart: periodStartIso,
        periodEnd: periodEndIso,
        items: digestItems,
        cadence,
        lane: "customer",
      });
      if (delivery.attempts > 0) {
        digestsSent += 1;
      }
    } catch (error) {
      // One user's digest failure must never abort the remaining users.
      console.error(
        `Digest run failed for user ${user.id}; continuing with remaining users.`,
        error,
      );
    }
  }

  digestsSent += await retryFailedDigests(env, { retryCandidates, handledDigestRunIds });

  return digestsSent;
}

async function retryFailedDigests(
  env: AppEnv,
  input: {
    retryCandidates: Awaited<ReturnType<typeof listRetryableDigestRuns>>;
    handledDigestRunIds: Set<string>;
  },
) {
  let retried = 0;

  for (const candidate of input.retryCandidates) {
    if (input.handledDigestRunIds.has(candidate.id)) {
      continue;
    }

    try {
      const plan = await getUserPlan(env, candidate.userId);
      const cadence = digestCadenceForPeriod(candidate.periodStart, candidate.periodEnd);
      if (!PLAN_LIMITS[plan].digests || !planAllowsDigestCadence(plan, cadence)) {
        continue;
      }

	      const digest = await getDigest(env, candidate.id);
	      if (!digest) {
	        continue;
	      }
	      let heartbeat: { runs: number; watchlistsChecked: number; adsSeen: number } | null = null;
	      if (digest.items.length === 0) {
	        const runStats = await getSuccessfulRunStatsForUserBetween(
	          env,
	          candidate.userId,
	          candidate.periodStart,
	          candidate.periodEnd,
	        );
	        if (runStats.runs === 0) {
	          continue;
	        }
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
        items: digest.items.map((item) => ({
          eventId: item.id,
          watchlistId: item.watchlistId,
          watchlistName: item.watchlistName,
          eventType: item.eventType,
          title: item.title,
          summary: item.summary,
          metadata: item.metadata,
        })),
        cadence,
        lane: "customer",
      });
      if (delivery.attempts > 0) {
        retried += 1;
      }
    } catch (error) {
      console.error(
        `Digest retry failed for digest run ${candidate.id}; continuing with remaining retries.`,
        error,
      );
    }
  }

  return retried;
}

function digestCadenceForPeriod(periodStart: string, periodEnd: string): DigestCadence {
  const spanMs = new Date(periodEnd).getTime() - new Date(periodStart).getTime();
  return spanMs <= 36 * 60 * 60 * 1000 ? "daily" : "weekly";
}

function shouldIncludeScoutInScheduledMonitoring(options: RunScheduledMonitoringOptions) {
  const scheduledAt = options.scheduledTime === undefined
    ? new Date()
    : new Date(options.scheduledTime);

  return shouldSchedulePlanInRegularScan("scout", scheduledAt);
}

async function resolveWatchlistQuery(env: AppEnv, watchlist: WatchlistRecord) {
  if (watchlist.targetType === "advertiser") {
    return normalizeSavedQuery("advertiser", {
      query: watchlist.targetLabel,
      // Legacy watchlists (created before target_country existed) were all
      // scanned as India; keep that behavior so their diffs stay coherent.
      country: watchlist.targetCountry ?? "India",
    });
  }

  const savedQuery = await getSavedQuery(env, watchlist.targetId);
  return savedQuery?.normalizedQuery ?? null;
}

async function runScheduledMonitoringInline(
  env: AppEnv,
  watchlists: WatchlistRecord[],
  deadlineAt: number,
  options: {
    scheduledTime?: number;
    cron?: string | null;
  } = {},
) {
  const scanCache = new Map<string, Promise<ScanPayload>>();
  let inlineRuns = 0;
  let inlineFailures = 0;
  let skippedForBudget = 0;

  for (let index = 0; index < watchlists.length; index += 1) {
    if (Date.now() > deadlineAt) {
      skippedForBudget = watchlists.length - index;
      for (let skipIndex = index; skipIndex < watchlists.length; skipIndex += 1) {
        await recordWatchlistCapacitySkip(env, watchlists[skipIndex]!.id, {
          scheduledTime: options.scheduledTime,
          cron: options.cron,
        });
      }
      break;
    }

    const watchlist = watchlists[index]!;

    try {
      const ranInline = await runScheduledWatchlistInline(env, watchlist, scanCache, options);
      inlineRuns += ranInline ? 1 : 0;
    } catch (error) {
      // One watchlist failure must never abort the rest of the scheduled run
      // (or the digests that precede it). The run itself is already recorded
      // as failed by runWatchlist before it rethrows.
      inlineFailures += 1;
      console.error(
        `Scheduled scan failed for watchlist ${watchlist.id}; continuing with remaining watchlists.`,
        error,
      );
    }
  }

  return { inlineRuns, inlineFailures, skippedForBudget };
}

async function runScheduledWatchlistInline(
  env: AppEnv,
  watchlist: WatchlistRecord,
  scanCache: Map<string, Promise<ScanPayload>>,
  options: {
    scheduledTime?: number;
    cron?: string | null;
  } = {},
) {
  const query = await resolveWatchlistQuery(env, watchlist);
  if (!query) {
    return false;
  }

  const executionKey = buildWatchlistExecutionIdempotencyKey({
    watchlistId: watchlist.id,
    triggerType: "scheduled",
    scheduledTime: options.scheduledTime,
    cron: options.cron,
  });
  if (await hasOrchestratedRunBlockingInlineScan(env, watchlist.id, executionKey)) {
    return false;
  }

  const customerMetaAdLibraryToken = await resolveWatchlistCustomerMetaAdLibraryToken(env, watchlist);
  const scanCacheKey = `${watchlist.userId}:${watchlist.targetFingerprint}`;

  await runWatchlist(
    env,
    watchlist,
    "scheduled",
    () => {
      if (!scanCache.has(scanCacheKey)) {
        scanCache.set(
          scanCacheKey,
          performBoundedScan(env, query, DEFAULT_PAGE_BUDGET, {
            customerMetaAdLibraryToken,
            forceLive: true,
          }),
        );
      }
      return scanCache.get(scanCacheKey)!;
    },
    {
      customerMetaAdLibraryToken,
    },
  );
  return true;
}

async function performBoundedScan(
  env: AppEnv,
  query: NormalizedSavedQuery,
  pageBudget: number,
  options: ScanOptions = {},
): Promise<ScanPayload> {
  let cursor: string | null | undefined = null;
  let pagesScanned = 0;
  let degraded = false;
  const ads: AdRecord[] = [];

  do {
    const response = await searchAdsViaSourceResolver(
      env,
      query,
      cursor ?? null,
      {
        purpose: "watchlist_scan",
        customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
        forceLive: options.forceLive === true,
      },
    );
    ads.push(...response.ads);
    // Cooldown fallbacks serve old cached payloads; diffing them fabricates
    // ad_new/ad_inactive events about ads that never changed.
    if (response.discoveryStatus === "cache_only" || response.cacheStatus === "stale") {
      degraded = true;
    }
    cursor = response.nextCursor;
    pagesScanned += 1;

    if (options.orchestrationRunId && options.orchestrationToken) {
      await renewOrchestratedWatchlistRunLease(env, {
        runId: options.orchestrationRunId,
        processingToken: options.orchestrationToken,
      });
    }
    if (options.concurrencyPermitToken) {
      await renewMonitoringConcurrencySlot(env, { token: options.concurrencyPermitToken });
    }
  } while (cursor && pagesScanned < pageBudget);

  const hydratedAds = await hydrateAdsWithPersistedCreatives(env, dedupeAds(ads));

  return {
    ads: hydratedAds,
    pagesScanned,
    degraded,
  };
}

async function resolveWatchlistCustomerMetaAdLibraryToken(
  env: AppEnv,
  watchlist: WatchlistRecord,
) {
  try {
    const { getCustomerMetaAdLibraryToken } = await import("~/lib/customer-meta.server");
    return await getCustomerMetaAdLibraryToken(env, watchlist.userId);
  } catch {
    return null;
  }
}

function buildScanNativeEventDrafts(
  watchlist: WatchlistRecord,
  current: ObservationRecord[],
  baseline: ObservationRecord[],
  prior: ObservationRecord[],
  hasBaselineRun: boolean,
) {
  if (!hasBaselineRun) {
    // First successful scan: there is nothing to diff against, and reporting
    // every existing ad as "New ad detected" floods the first digest with
    // false positives — teaching the customer from day one that alerts are
    // noise. One honest baseline event replaces the flood. (Rides the ad_new
    // type because watch_event.event_type is CHECK-constrained; metadata.kind
    // distinguishes it wherever it renders.)
    if (current.length === 0) {
      return [];
    }

    const count = current.length;
    return [
      {
        eventType: "ad_new" as const,
        adId: null,
        title: `Baseline captured: ${count} active ad${count === 1 ? "" : "s"}`,
        summary: `We recorded ${count} active ad${count === 1 ? "" : "s"} for ${watchlist.name} as your starting point. From the next scan onward, you'll only hear about real changes.`,
        metadata: {
          kind: "baseline",
          adsSeen: count,
        },
      },
    ];
  }

  return diffWatchlistObservations(watchlist, current, baseline, prior);
}

async function persistCheapScanObservations(
  env: AppEnv,
  runId: string,
  ads: AdRecord[],
) {
  for (const ad of ads) {
    const enrichedAd = await enrichAdForCheapScan(env, ad);
    await upsertAd(env, enrichedAd);

    await createAdObservation(env, {
      adId: enrichedAd.metaAdId,
      watchlistRunId: runId,
      landingPageSnapshotId: null,
      landingPageUrl: enrichedAd.landingPageUrl,
      seenAt: new Date().toISOString(),
      isActive: enrichedAd.active,
      metadata: {
        advertiser: enrichedAd.advertiser,
        hook: enrichedAd.hook,
        offer: enrichedAd.offer,
      },
    });
  }
}

async function persistScanNativeEvents(
  env: AppEnv,
  watchlistId: string,
  runId: string,
  baselineFromRunId: string | null,
  drafts: WatchEventDraft[],
) {
  const createdEvents: WatchEventRecord[] = [];

  for (const draft of drafts) {
    const importanceScore = getScanNativeImportanceScore(draft.eventType);
    const candidateId = await createEventCandidate(env, {
      watchlistId,
      runId,
      eventType: draft.eventType,
      status: "confirmed",
      importanceScore,
      adId: draft.adId,
      title: draft.title,
      summary: draft.summary,
      metadata: draft.metadata,
      proofRequired: false,
      lastEvaluatedAt: new Date().toISOString(),
    });

    const eventId = await createWatchEvent(env, {
      watchlistId,
      runId,
      eventType: draft.eventType,
      adId: draft.adId,
      baselineFromRunId,
      candidateId,
      importanceScore,
      title: draft.title,
      summary: draft.summary,
      metadata: draft.metadata,
    });
    createdEvents.push({
      id: eventId,
      watchlistId,
      runId,
      eventType: draft.eventType,
      status: "confirmed",
      importanceScore,
      adId: draft.adId,
      baselineFromRunId,
      candidateId,
      proofCaptureId: null,
      title: draft.title,
      summary: draft.summary,
      metadata: draft.metadata,
      confirmedAt: null,
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: null,
      createdAt: new Date().toISOString(),
    });
  }

  return createdEvents;
}

async function resolveWorkspaceEvidenceCapacity(env: AppEnv, workspaceUserId: string) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    const userPlan = await getProofCapturePlan(env, workspaceUserId);
    const purchasedProofCredits = 0;
    const workspaceMonthlyCap = monthlyProofCapForPlan(userPlan) + purchasedProofCredits;
    return {
      userPlan,
      purchasedProofCredits,
      workspaceMonthlyCap,
      workspaceMonthlyRemaining: workspaceMonthlyCap,
      workspaceDailyCap: dailyProofCapForPlan(userPlan, purchasedProofCredits),
      includedUsed: 0,
    };
  }

  try {
    const summary = await getEvidenceUsageSummary(env, workspaceUserId);
    const userPlan = summary.plan;
    const purchasedProofCredits = summary.topUpRemaining;
    return {
      userPlan,
      purchasedProofCredits,
      workspaceMonthlyCap: summary.includedAllowance + purchasedProofCredits,
      workspaceMonthlyRemaining: summary.totalAvailable,
      workspaceDailyCap: dailyProofCapForPlan(userPlan, purchasedProofCredits),
      includedUsed: summary.includedUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isEvidenceUsageStorageUnavailableError(message)) {
      throw error;
    }

    const now = new Date().toISOString();
    const proofWindowStart = startOfRollingProofWindowIso();
    const userPlan = await getProofCapturePlan(env, workspaceUserId);
    const purchasedProofCredits = await sumActiveProofUsageCredits(
      env,
      workspaceUserId,
      proofWindowStart,
      now,
    );
    const workspaceMonthlyCap = monthlyProofCapForPlan(userPlan) + purchasedProofCredits;
    const workspaceMonthlyAttempts = await countProofCapturesForWorkspaceSince(
      env,
      workspaceUserId,
      proofWindowStart,
    );
    return {
      userPlan,
      purchasedProofCredits,
      workspaceMonthlyCap,
      workspaceMonthlyRemaining: Math.max(0, workspaceMonthlyCap - workspaceMonthlyAttempts),
      workspaceDailyCap: dailyProofCapForPlan(userPlan, purchasedProofCredits),
      includedUsed: workspaceMonthlyAttempts,
    };
  }
}

async function evaluateSelectiveProofCandidates(
  env: AppEnv,
  input: {
    watchlist: WatchlistRecord;
    runId: string;
    currentObservations: ObservationRecord[];
    scanNativeDrafts: WatchEventDraft[];
    recentWatchEvents: WatchEventRecord[];
  },
) {
  const proofEvents: WatchEventRecord[] = [];
  const eventTypesByAd = mapEventTypesByAdId(input.scanNativeDrafts);
  const todayStart = startOfUtcDayIso();
  const now = new Date().toISOString();
  const capacity = await resolveWorkspaceEvidenceCapacity(env, input.watchlist.userId);
  const userPlan = capacity.userPlan;
  const purchasedProofCredits = capacity.purchasedProofCredits;
  const workspaceMonthlyCap = capacity.workspaceMonthlyCap;
  const workspaceDailyCap = capacity.workspaceDailyCap;
  const watchlistDailyAttempts = await countProofCapturesForWatchlistSince(
    env,
    input.watchlist.id,
    todayStart,
  );
  const workspaceDailyAttempts = await countProofCapturesForWorkspaceSince(
    env,
    input.watchlist.userId,
    todayStart,
  );
  const workspaceMonthlyAttempts = capacity.includedUsed;
  const workspaceRecentAttempts = await listRecentWorkspaceProofCaptures(env, input.watchlist.userId, 20);
  const proofAwareRecentEvents = [...input.recentWatchEvents];
  let watchlistRunAttemptCount = 0;
  let watchlistDailyAttemptCount = watchlistDailyAttempts;
  let workspaceDailyAttemptCount = workspaceDailyAttempts;
  let workspaceMonthlyAttemptCount = workspaceMonthlyAttempts;
  let candidateCount = 0;
  let proofAttemptCount = 0;
  let confirmedEventCount = 0;

  type ProofCandidate = {
    observation: (typeof input.currentObservations)[number];
    canonicalPageIdentity: string;
    proofTargetIdentity: string;
    proofTarget: NonNullable<Awaited<ReturnType<typeof upsertProofTarget>>>;
  };

  const proofCandidates: ProofCandidate[] = [];
  for (const observation of input.currentObservations) {
    if (!observation.landing_page_url || !observation.ad_id) {
      continue;
    }

    const canonicalPageIdentity = buildCanonicalPageIdentity(observation.landing_page_url);
    if (!canonicalPageIdentity) {
      continue;
    }

    const proofTargetIdentity = buildProofTargetIdentity({
      watchlistId: input.watchlist.id,
      adId: observation.ad_id,
      canonicalPageIdentity,
    });
    const proofTarget = await upsertProofTarget(env, {
      watchlistId: input.watchlist.id,
      adId: observation.ad_id,
      landingPageUrl: observation.landing_page_url,
      canonicalPageIdentity,
      proofTargetIdentity,
    });

    if (!proofTarget) {
      continue;
    }

    proofCandidates.push({
      observation,
      canonicalPageIdentity,
      proofTargetIdentity,
      proofTarget,
    });
  }

  // Batch-load proof history for all candidates before the capture loop so
  // each ad only pays for serial Browser Rendering, not serial D1 reads.
  const capturesByTargetId = await listProofCapturesForTargets(
    env,
    proofCandidates.map((candidate) => candidate.proofTarget.id),
    20,
  );
  const successfulCapturesByAdId = await listLastSuccessfulProofCapturesForAds(
    env,
    input.watchlist.id,
    proofCandidates.map((candidate) => candidate.observation.ad_id).filter(Boolean),
    5,
  );

  for (const candidate of proofCandidates) {
    const { observation, canonicalPageIdentity, proofTargetIdentity, proofTarget } = candidate;

    const targetCaptures = capturesByTargetId.get(proofTarget.id) ?? [];
    const lastSuccessfulProof =
      selectLastSuccessfulProofCapture(targetCaptures) ??
      selectLastSuccessfulProofCapture(
        successfulCapturesByAdId.get(observation.ad_id) ?? [],
      );
    const primaryTriggerEventType =
      eventTypesByAd.get(observation.ad_id)?.[0] ?? "landing_page_headline_changed";
    const proofRequestKeyBase = buildProofCaptureRequestIdempotencyKey({
      watchlistId: input.watchlist.id,
      adId: observation.ad_id,
      landingPageUrl: observation.landing_page_url!,
      eventType: primaryTriggerEventType,
    });
    const proofRequestKey = [proofRequestKeyBase, input.runId].join(":");
    const proofRequestDuplicate = targetCaptures.some((capture) => {
      if (!matchesProofRequestKey(capture.idempotencyKey, proofRequestKeyBase)) {
        return false;
      }

      return (
        Date.now() - new Date(capture.attemptedAt).getTime() <
        6 * 60 * 60 * 1000
      );
    });
    const recentFailureCountForTarget = targetCaptures.filter(
      (capture) => capture.status === "failed",
    ).length;
    const proofDecision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: eventTypesByAd.get(observation.ad_id) ?? [],
      lastSuccessfulProofAt: lastSuccessfulProof?.succeededAt ?? proofTarget.lastSuccessfulProofAt,
      watchlistRunAttemptCount,
      watchlistDailyAttemptCount,
      workspaceDailyAttemptCount,
      workspaceMonthlyAttemptCount,
      workspaceMonthlyCap,
      workspaceEvidenceRemaining: capacity.workspaceMonthlyRemaining,
      workspaceDailyCap,
      workspaceRecentAttempts,
      activeCaptureCount: 0,
      burstCount: (eventTypesByAd.get(observation.ad_id) ?? []).length,
      proofRequestDuplicate,
      recentFailureCountForTarget,
    });

    if (!proofDecision.shouldCapture) {
      if (proofDecision.skipReason) {
        await createProofCapture(env, {
          proofTargetId: proofTarget.id,
          status: proofDecision.skipReason,
          skipReason: proofDecision.skipReason,
          failureReason: "Evidence policy skipped the attempt.",
          extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        });
      }
      continue;
    }

    watchlistRunAttemptCount += 1;
    watchlistDailyAttemptCount += 1;
    workspaceDailyAttemptCount += 1;
    proofAttemptCount += 1;

    const evidenceReservation = await tryReserveEvidenceForProofCapture(env, {
      workspaceUserId: input.watchlist.userId,
      proofTargetId: proofTarget.id,
      idempotencyKey: proofRequestKey,
      source: "monitoring.scan",
    });

    if (evidenceReservation && !evidenceReservation.result.ok) {
      await createProofCapture(env, {
        proofTargetId: proofTarget.id,
        status: "skipped_due_to_budget",
        skipReason: "skipped_due_to_budget",
        failureReason:
          evidenceReservation.result.reason === "top_up_inactive_plan"
            ? "Purchased checks require an active paid plan."
            : "Evidence check allowance exhausted.",
        extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
      });
      continue;
    }

    if (evidenceReservation?.result.ok || !evidenceReservation) {
      workspaceMonthlyAttemptCount += 1;
    }

    const evidenceOperationKey = evidenceReservation?.logicalOperationKey ?? null;
    const snapshot = await captureLandingPageSnapshot(env, observation.landing_page_url!);

    if (!snapshot) {
      if (evidenceOperationKey) {
        await tryFinalizeEvidenceForProofCapture(env, evidenceOperationKey, "failed");
      }
      await createProofCapture(env, {
        proofTargetId: proofTarget.id,
        status: "failed",
        failureCode: "proof_capture_failed",
        failureReason: "Landing-page evidence check failed.",
        extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        idempotencyKey: proofRequestKey,
      });
      await upsertProofTarget(env, {
        watchlistId: input.watchlist.id,
        adId: observation.ad_id,
        landingPageUrl: observation.landing_page_url!,
        canonicalPageIdentity,
        proofTargetIdentity,
        lastCaptureAttemptAt: new Date().toISOString(),
        lastSuccessfulProofAt: proofTarget.lastSuccessfulProofAt,
        lastSuccessfulCaptureId: proofTarget.lastSuccessfulCaptureId,
      });
      continue;
    }

    const extractedFields = snapshotToExtractedFields(snapshot);
    const fieldConfidence = readSnapshotConfidence(snapshot);
    const extractionWarnings = readSnapshotWarnings(snapshot);
    const finalCanonicalPageIdentity =
      buildCanonicalPageIdentity(snapshot.canonicalUrl) ?? canonicalPageIdentity;
    const finalProofTargetIdentity = buildProofTargetIdentity({
      watchlistId: input.watchlist.id,
      adId: observation.ad_id,
      canonicalPageIdentity: finalCanonicalPageIdentity,
    });
    const persistedProofTarget =
      (await upsertProofTarget(env, {
        watchlistId: input.watchlist.id,
        adId: observation.ad_id,
        landingPageUrl: snapshot.canonicalUrl,
        canonicalPageIdentity: finalCanonicalPageIdentity,
        proofTargetIdentity: finalProofTargetIdentity,
      })) ?? proofTarget;
    const proofCaptureId = await createProofCapture(env, {
      proofTargetId: persistedProofTarget.id,
      status: "succeeded",
      screenshotArtifactKey: readSnapshotString(snapshot.metadata, "screenshotArtifactKey"),
      htmlArtifactKey:
        readSnapshotString(snapshot.metadata, "htmlArtifactKey") ?? snapshot.artifactKey ?? null,
      extractedFields,
      fieldConfidence,
      extractionWarnings,
      captureMetadata: snapshot.metadata ?? {},
      renderMode: readSnapshotRenderMode(snapshot),
      deviceProfile: readSnapshotDeviceProfile(snapshot),
      extractorVersion:
        readSnapshotString(snapshot.metadata, "extractorVersion") ??
        LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
      idempotencyKey: proofRequestKey,
      attemptedAt: snapshot.capturedAt,
      succeededAt: snapshot.capturedAt,
    });
    if (evidenceOperationKey) {
      await tryFinalizeEvidenceForProofCapture(env, evidenceOperationKey, "succeeded");
    }
    await upsertProofTarget(env, {
      watchlistId: input.watchlist.id,
      adId: observation.ad_id,
      landingPageUrl: snapshot.canonicalUrl,
      canonicalPageIdentity: finalCanonicalPageIdentity,
      proofTargetIdentity: finalProofTargetIdentity,
      lastCaptureAttemptAt: snapshot.capturedAt,
      lastSuccessfulProofAt: snapshot.capturedAt,
      lastSuccessfulCaptureId: proofCaptureId,
    });

    const evaluated = evaluateProofBackedEvents({
      proofTargetIdentity: finalProofTargetIdentity,
      currentProof: {
        rawHeadline: snapshot.rawHeadline,
        normalizedHeadline: snapshot.normalizedHeadline,
        normalizedHeadlineHash: snapshot.normalizedHeadlineHash,
        ctaText: snapshot.ctaText ?? null,
        priceText: snapshot.priceText ?? null,
        formPresent: snapshot.formPresent ?? null,
      },
      lastSuccessfulProof,
      recentWatchEvents: proofAwareRecentEvents,
      sensitivityMode: "balanced",
      burstCount: (eventTypesByAd.get(observation.ad_id) ?? []).length,
    });

    for (const event of evaluated.events) {
      const candidateId = await createEventCandidate(env, {
        watchlistId: input.watchlist.id,
        runId: input.runId,
        eventType: event.eventType,
        status: event.status,
        importanceScore: event.importanceScore,
        adId: observation.ad_id,
        proofTargetId: persistedProofTarget.id,
        title: event.title,
        summary: event.summary,
        metadata: event.metadata,
        proofRequired: true,
        dedupeReason: event.dedupeReason,
        lastEvaluatedAt: snapshot.capturedAt,
      });
      candidateCount += 1;

      if (event.status !== "confirmed") {
        continue;
      }

      const eventId = await createWatchEvent(env, {
        watchlistId: input.watchlist.id,
        runId: input.runId,
        eventType: event.eventType,
        status: "confirmed",
        importanceScore: event.importanceScore,
        adId: observation.ad_id,
        baselineFromRunId: null,
        candidateId,
        proofCaptureId,
        title: event.title,
        summary: event.summary,
        metadata: event.metadata,
        confirmedAt: snapshot.capturedAt,
        lastEvaluatedAt: snapshot.capturedAt,
      });
      confirmedEventCount += 1;

      const createdEvent = {
        id: eventId,
        watchlistId: input.watchlist.id,
        runId: input.runId,
        eventType: event.eventType,
        status: "confirmed" as const,
        importanceScore: event.importanceScore,
        adId: observation.ad_id,
        baselineFromRunId: null,
        candidateId,
        proofCaptureId,
        title: event.title,
        summary: event.summary,
        metadata: event.metadata,
        confirmedAt: snapshot.capturedAt,
        suppressedAt: null,
        invalidatedAt: null,
        lastEvaluatedAt: snapshot.capturedAt,
        createdAt: snapshot.capturedAt,
      };
      proofAwareRecentEvents.push(createdEvent);
      proofEvents.push(createdEvent);
    }
  }

  return {
    events: proofEvents,
    candidateCount,
    proofAttemptCount,
    confirmedEventCount,
  };
}

async function evaluateDirectWebsiteProofCandidate(
  env: AppEnv,
  input: {
    watchlist: WatchlistRecord;
    runId: string;
    recentWatchEvents: WatchEventRecord[];
    watchlistRunAttemptCount: number;
  },
) {
  const websiteUrl = directWebsiteUrlForWatchlist(input.watchlist);
  if (!websiteUrl) {
    return emptyProofEvaluation(null);
  }

  if (input.watchlistRunAttemptCount >= V1_PROOF_BUDGETS.perWatchlistRun) {
    return emptyProofEvaluation(websiteUrl);
  }

  const now = new Date().toISOString();
  const todayStart = startOfUtcDayIso();
  const capacity = await resolveWorkspaceEvidenceCapacity(env, input.watchlist.userId);
  const userPlan = capacity.userPlan;
  const purchasedProofCredits = capacity.purchasedProofCredits;
  const workspaceMonthlyCap = capacity.workspaceMonthlyCap;
  const workspaceDailyCap = capacity.workspaceDailyCap;
  const [watchlistDailyAttempts, workspaceDailyAttempts, workspaceMonthlyAttempts] = await Promise.all([
    countProofCapturesForWatchlistSince(env, input.watchlist.id, todayStart),
    countProofCapturesForWorkspaceSince(env, input.watchlist.userId, todayStart),
    Promise.resolve(capacity.includedUsed),
  ]);

  if (
    watchlistDailyAttempts >= V1_PROOF_BUDGETS.perWatchlistDay ||
    workspaceDailyAttempts >= workspaceDailyCap ||
    workspaceMonthlyAttempts >= workspaceMonthlyCap
  ) {
    return emptyProofEvaluation(websiteUrl);
  }

  const canonicalPageIdentity = buildCanonicalPageIdentity(websiteUrl);
  if (!canonicalPageIdentity) {
    return emptyProofEvaluation(websiteUrl);
  }

  const proofTargetIdentity = buildProofTargetIdentity({
    watchlistId: input.watchlist.id,
    adId: null,
    canonicalPageIdentity,
  });
  const proofTarget = await upsertProofTarget(env, {
    watchlistId: input.watchlist.id,
    adId: null,
    landingPageUrl: websiteUrl,
    canonicalPageIdentity,
    proofTargetIdentity,
  });

  if (!proofTarget) {
    return emptyProofEvaluation(websiteUrl);
  }

  const targetCaptures = await listProofCapturesForTarget(env, proofTarget.id, 20);
  const lastSuccessfulProof = selectLastSuccessfulProofCapture(targetCaptures);
  const proofRequestKeyBase = buildProofCaptureRequestIdempotencyKey({
    watchlistId: input.watchlist.id,
    adId: null,
    landingPageUrl: websiteUrl,
    eventType: "landing_page_offer_changed",
  });
  const proofRequestKey = [proofRequestKeyBase, input.runId].join(":");
  const proofRequestDuplicate = targetCaptures.some((capture) => {
    if (!matchesProofRequestKey(capture.idempotencyKey, proofRequestKeyBase)) {
      return false;
    }

    return (
      Date.now() - new Date(capture.attemptedAt).getTime() <
      6 * 60 * 60 * 1000
    );
  });
  const recentFailureCountForTarget = targetCaptures.filter(
    (capture) => capture.status === "failed",
  ).length;

  if (
    isWithinDirectWebsiteProofInterval(
      lastSuccessfulProof?.succeededAt ?? proofTarget.lastSuccessfulProofAt,
    )
  ) {
    return emptyProofEvaluation(websiteUrl);
  }

  if (proofRequestDuplicate) {
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "skipped_due_to_dedupe",
      skipReason: "skipped_due_to_dedupe",
      failureReason: "Direct website evidence was already requested recently.",
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    });
    return emptyProofEvaluation(websiteUrl);
  }

  if (
    input.watchlistRunAttemptCount >= V1_PROOF_BUDGETS.perWatchlistRun ||
    recentFailureCountForTarget >= 2
  ) {
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "skipped_due_to_rate_limit",
      skipReason: "skipped_due_to_rate_limit",
      failureReason: "Direct website evidence policy skipped the attempt.",
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    });
    return emptyProofEvaluation(websiteUrl);
  }

  const evidenceReservation = await tryReserveEvidenceForProofCapture(env, {
    workspaceUserId: input.watchlist.userId,
    proofTargetId: proofTarget.id,
    idempotencyKey: proofRequestKey,
    source: "monitoring.direct_website",
  });

  if (evidenceReservation && !evidenceReservation.result.ok) {
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "skipped_due_to_budget",
      skipReason: "skipped_due_to_budget",
      failureReason:
        evidenceReservation.result.reason === "top_up_inactive_plan"
          ? "Purchased checks require an active paid plan."
          : "Evidence check allowance exhausted.",
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    });
    return emptyProofEvaluation(websiteUrl);
  }

  if (
    capacity.workspaceMonthlyRemaining <= 0 &&
    !evidenceReservation
  ) {
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "skipped_due_to_budget",
      skipReason: "skipped_due_to_budget",
      failureReason: "Evidence check allowance exhausted.",
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    });
    return emptyProofEvaluation(websiteUrl);
  }

  const evidenceOperationKey = evidenceReservation?.logicalOperationKey ?? null;
  const snapshot = await captureLandingPageSnapshot(env, websiteUrl, {
    preferRendered: true,
  });

  if (!snapshot) {
    if (evidenceOperationKey) {
      await tryFinalizeEvidenceForProofCapture(env, evidenceOperationKey, "failed");
    }
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "failed",
      failureCode: "direct_website_proof_capture_failed",
      failureReason: "Competitor website evidence check failed.",
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
      idempotencyKey: proofRequestKey,
    });
    return {
      ...emptyProofEvaluation(websiteUrl),
      proofAttemptCount: 1,
    };
  }

  const extractedFields = snapshotToExtractedFields(snapshot);
  const finalCanonicalPageIdentity =
    buildCanonicalPageIdentity(snapshot.canonicalUrl) ?? canonicalPageIdentity;
  const finalProofTargetIdentity = buildProofTargetIdentity({
    watchlistId: input.watchlist.id,
    adId: null,
    canonicalPageIdentity: finalCanonicalPageIdentity,
  });
  const persistedProofTarget =
    (await upsertProofTarget(env, {
      watchlistId: input.watchlist.id,
      adId: null,
      landingPageUrl: snapshot.canonicalUrl,
      canonicalPageIdentity: finalCanonicalPageIdentity,
      proofTargetIdentity: finalProofTargetIdentity,
      lastCaptureAttemptAt: snapshot.capturedAt,
      lastSuccessfulProofAt: snapshot.capturedAt,
    })) ?? proofTarget;
  const finalTargetCaptures = await listProofCapturesForTarget(env, persistedProofTarget.id, 20);
  const finalLastSuccessfulProof =
    selectLastSuccessfulProofCapture(finalTargetCaptures) ?? lastSuccessfulProof;
  const finalProofRequestKey = [
    buildProofCaptureRequestIdempotencyKey({
      watchlistId: input.watchlist.id,
      adId: null,
      landingPageUrl: snapshot.canonicalUrl,
      eventType: "landing_page_offer_changed",
    }),
    input.runId,
  ].join(":");
  const proofCaptureId = await createProofCapture(env, {
    proofTargetId: persistedProofTarget.id,
    status: "succeeded",
    screenshotArtifactKey: readSnapshotString(snapshot.metadata, "screenshotArtifactKey"),
    htmlArtifactKey:
      readSnapshotString(snapshot.metadata, "htmlArtifactKey") ?? snapshot.artifactKey ?? null,
    extractedFields,
    fieldConfidence: readSnapshotConfidence(snapshot),
    extractionWarnings: readSnapshotWarnings(snapshot),
    captureMetadata: {
      ...(snapshot.metadata ?? {}),
      source: "direct_competitor_website",
      watchlistTargetId: input.watchlist.targetId,
    },
    renderMode: readSnapshotRenderMode(snapshot),
    deviceProfile: readSnapshotDeviceProfile(snapshot),
    extractorVersion:
      readSnapshotString(snapshot.metadata, "extractorVersion") ??
      LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    idempotencyKey: finalProofRequestKey,
    attemptedAt: snapshot.capturedAt,
    succeededAt: snapshot.capturedAt,
  });
  if (evidenceOperationKey) {
    await tryFinalizeEvidenceForProofCapture(env, evidenceOperationKey, "succeeded");
  }
  await upsertProofTarget(env, {
    watchlistId: input.watchlist.id,
    adId: null,
    landingPageUrl: snapshot.canonicalUrl,
    canonicalPageIdentity: finalCanonicalPageIdentity,
    proofTargetIdentity: finalProofTargetIdentity,
    lastCaptureAttemptAt: snapshot.capturedAt,
      lastSuccessfulProofAt: snapshot.capturedAt,
      lastSuccessfulCaptureId: proofCaptureId,
    });
  if (finalProofTargetIdentity !== proofTargetIdentity) {
    await upsertProofTarget(env, {
      watchlistId: input.watchlist.id,
      adId: null,
      landingPageUrl: websiteUrl,
      canonicalPageIdentity,
      proofTargetIdentity,
      lastCaptureAttemptAt: snapshot.capturedAt,
      lastSuccessfulProofAt: snapshot.capturedAt,
    });
  }

  const evaluated = evaluateProofBackedEvents({
    proofTargetIdentity: finalProofTargetIdentity,
    currentProof: {
      rawHeadline: snapshot.rawHeadline,
      normalizedHeadline: snapshot.normalizedHeadline,
      normalizedHeadlineHash: snapshot.normalizedHeadlineHash,
      ctaText: snapshot.ctaText ?? null,
      priceText: snapshot.priceText ?? null,
      formPresent: snapshot.formPresent ?? null,
    },
    lastSuccessfulProof: finalLastSuccessfulProof,
    recentWatchEvents: input.recentWatchEvents,
    sensitivityMode: "balanced",
    burstCount: 1,
  });

  const proofEvents: WatchEventRecord[] = [];
  let candidateCount = 0;
  let confirmedEventCount = 0;

  for (const event of evaluated.events) {
    const candidateId = await createEventCandidate(env, {
      watchlistId: input.watchlist.id,
      runId: input.runId,
      eventType: event.eventType,
      status: event.status,
      importanceScore: event.importanceScore,
      adId: null,
      proofTargetId: persistedProofTarget.id,
      title: event.title,
      summary: event.summary,
      metadata: {
        ...event.metadata,
        source: "direct_competitor_website",
        websiteUrl: snapshot.canonicalUrl,
      },
      proofRequired: true,
      dedupeReason: event.dedupeReason,
      lastEvaluatedAt: snapshot.capturedAt,
    });
    candidateCount += 1;

    if (event.status !== "confirmed") {
      continue;
    }

    const eventId = await createWatchEvent(env, {
      watchlistId: input.watchlist.id,
      runId: input.runId,
      eventType: event.eventType,
      status: "confirmed",
      importanceScore: event.importanceScore,
      adId: null,
      baselineFromRunId: null,
      candidateId,
      proofCaptureId,
      title: event.title,
      summary: event.summary,
      metadata: {
        ...event.metadata,
        source: "direct_competitor_website",
        websiteUrl: snapshot.canonicalUrl,
      },
      confirmedAt: snapshot.capturedAt,
      lastEvaluatedAt: snapshot.capturedAt,
    });
    confirmedEventCount += 1;

    proofEvents.push({
      id: eventId,
      watchlistId: input.watchlist.id,
      runId: input.runId,
      eventType: event.eventType,
      status: "confirmed",
      importanceScore: event.importanceScore,
      adId: null,
      baselineFromRunId: null,
      candidateId,
      proofCaptureId,
      title: event.title,
      summary: event.summary,
      metadata: {
        ...event.metadata,
        source: "direct_competitor_website",
        websiteUrl: snapshot.canonicalUrl,
      },
      confirmedAt: snapshot.capturedAt,
      suppressedAt: null,
      invalidatedAt: null,
      lastEvaluatedAt: snapshot.capturedAt,
      createdAt: snapshot.capturedAt,
    });
  }

	  return {
	    events: proofEvents,
	    candidateCount,
	    proofAttemptCount: 1,
	    confirmedEventCount,
	    websiteUrl: snapshot.canonicalUrl,
	    proofCaptureSucceeded: true,
	  };
	}

	function emptyProofEvaluation(websiteUrl: string | null) {
	  return {
	    events: [] as WatchEventRecord[],
	    candidateCount: 0,
	    proofAttemptCount: 0,
	    confirmedEventCount: 0,
	    websiteUrl,
	    proofCaptureSucceeded: false,
	  };
	}

function directWebsiteUrlForWatchlist(watchlist: WatchlistRecord) {
  if (watchlist.targetType !== "advertiser") {
    return null;
  }

  return normalizePublicHttpUrl(watchlist.targetId)?.toString() ?? null;
}

function isWithinDirectWebsiteProofInterval(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < DIRECT_WEBSITE_PROOF_INTERVAL_MS;
}

export function buildProofCaptureRequestIdempotencyKey(input: {
  watchlistId: string;
  adId: string | null;
  landingPageUrl: string | null;
  eventType: WatchEventType;
}) {
  return [
    "proof-request",
    normalizeIdempotencySegment(input.watchlistId),
    normalizeIdempotencySegment(input.eventType),
    normalizeIdempotencySegment(input.adId ?? "none"),
    normalizeIdempotencySegment(normalizeIdempotencyUrl(input.landingPageUrl) ?? "none"),
  ].join(":");
}

function matchesProofRequestKey(idempotencyKey: string | null | undefined, requestKeyBase: string) {
  return Boolean(
    idempotencyKey &&
      (idempotencyKey === requestKeyBase || idempotencyKey.startsWith(`${requestKeyBase}:`)),
  );
}

function normalizeIdempotencyUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeIdempotencySegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function enrichAdForCheapScan(env: AppEnv, ad: AdRecord) {
  const capturedCreativeText =
    isAdLibraryBackedAd(ad) && ad.adSnapshotUrl && !ad.creativeText
      ? await captureCreativeText(env, ad.adSnapshotUrl, ad)
      : null;

  const nextAd = {
    ...ad,
    creativeText: capturedCreativeText?.text ?? ad.creativeText ?? null,
    creativeImageUrl: capturedCreativeText?.imageUrl ?? ad.creativeImageUrl ?? null,
    creativeTextCaptureMethod:
      capturedCreativeText?.captureMethod ?? ad.creativeTextCaptureMethod ?? null,
    creativeTextMetadata:
      capturedCreativeText?.metadata ?? ad.creativeTextMetadata ?? null,
  };

  return ensureAnalysisFields(nextAd);
}

function ensureAnalysisFields(ad: AdRecord): AdRecord {
  return {
    ...ad,
    analysisFields: buildAnalysisFields(ad, mapAdSourceToAnalysisSource(ad.source)),
  };
}

function mapObservationsByAdId(observations: ObservationRecord[]) {
  return new Map(observations.map((observation) => [observation.ad_id, observation]));
}

function dedupeAds(ads: AdRecord[]) {
  const unique = new Map<string, AdRecord>();
  for (const ad of ads) {
    unique.set(ad.metaAdId, ad);
  }
  return [...unique.values()];
}

function dedupeEventDrafts(drafts: WatchEventDraft[]) {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = `${draft.eventType}:${draft.adId ?? "none"}:${JSON.stringify(draft.metadata)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function summarizeEventTypes(drafts: WatchEventDraft[]) {
  return drafts.reduce<Record<string, number>>((accumulator, draft) => {
    accumulator[draft.eventType] = (accumulator[draft.eventType] ?? 0) + 1;
    return accumulator;
  }, {});
}

function mapEventTypesByAdId(drafts: WatchEventDraft[]) {
  return drafts.reduce<Map<string, WatchEventType[]>>((accumulator, draft) => {
    if (!draft.adId) {
      return accumulator;
    }

    const next = accumulator.get(draft.adId) ?? [];
    next.push(draft.eventType);
    accumulator.set(draft.adId, next);
    return accumulator;
  }, new Map());
}

function getScanNativeImportanceScore(eventType: WatchEventType) {
  switch (eventType) {
    case "landing_page_url_changed":
      return 85;
    case "landing_page_headline_changed":
      return 75;
    case "ad_new":
      return 65;
    case "ad_inactive":
      return 60;
    case "landing_page_offer_changed":
      return scoreWatchEventImportance({
        eventType,
        proofPresent: true,
        sensitivityMode: "balanced",
        burstCount: 1,
        indiaSignals: false,
      });
    case "landing_page_cta_changed":
    case "landing_page_form_changed":
      return scoreWatchEventImportance({
        eventType,
        proofPresent: true,
        sensitivityMode: "balanced",
        burstCount: 1,
        indiaSignals: false,
      });
    default:
      return 50;
  }
}

function startOfUtcDayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function startOfRollingProofWindowIso() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

// Daily proof ceilings sized so each plan's marketed monthly number is
// actually reachable (cap*30 > monthly), with purchased credit packs adding
// a smoothed daily allowance without expiring the underlying top-up balance.
const DAILY_PROOF_CAP_BY_PLAN: Record<string, number> = {
  free: 0,
  scout: 20,
  starter: 40,
  agency: 120,
};

export function dailyProofCapForPlan(plan: string, purchasedCredits: number) {
  const base = DAILY_PROOF_CAP_BY_PLAN[plan] ?? V1_PROOF_BUDGETS.perWorkspaceDay;
  return base + Math.ceil(Math.max(0, purchasedCredits) / 30);
}

function monthlyProofCapForPlan(plan: string) {
  const cap = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]?.proofCapturesPerMonth;
  return typeof cap === "number" ? cap : Number.POSITIVE_INFINITY;
}

async function getProofCapturePlan(env: AppEnv, userId: string) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return "starter";
  }

  return getUserPlan(env, userId);
}

async function sumActiveProofUsageCredits(
  env: AppEnv,
  userId: string,
  grantedSince: string,
  now: string,
) {
  if (!env.DB || typeof env.DB.prepare !== "function") return 0;

  try {
    const result = await env.DB.prepare(`
        SELECT COALESCE(SUM(credits), 0) AS total
        FROM proof_usage_credit
        WHERE user_id = ?
          AND granted_at >= ?
          AND expires_at > ?
      `).bind(userId, grantedSince, now).all<{ total: number }>();
    return Number(result.results?.[0]?.total ?? 0);
  } catch (error) {
    if (/proof_usage_credit|no such table/i.test(error instanceof Error ? error.message : String(error))) {
      return 0;
    }
    throw error;
  }
}

function snapshotToExtractedFields(snapshot: {
  rawHeadline: string;
  normalizedHeadline: string;
  normalizedHeadlineHash: string;
  ctaText?: string | null;
  priceText?: string | null;
  formPresent?: boolean | null;
  canonicalUrl: string;
}) {
  return {
    rawHeadline: snapshot.rawHeadline,
    normalizedHeadline: snapshot.normalizedHeadline,
    normalizedHeadlineHash: snapshot.normalizedHeadlineHash,
    ctaText: snapshot.ctaText ?? null,
    priceText: snapshot.priceText ?? null,
    formPresent: snapshot.formPresent ?? null,
    canonicalUrl: snapshot.canonicalUrl,
  };
}

function readSnapshotString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readSnapshotConfidence(snapshot: { metadata?: Record<string, unknown> }) {
  const confidence = snapshot.metadata?.extractedFieldConfidence;
  if (!confidence || typeof confidence !== "object" || Array.isArray(confidence)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(confidence).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

function readSnapshotWarnings(snapshot: { metadata?: Record<string, unknown> }) {
  const warnings = snapshot.metadata?.extractionWarnings;
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.filter((warning): warning is string => typeof warning === "string");
}

function readSnapshotRenderMode(snapshot: { metadata?: Record<string, unknown> }) {
  return readSnapshotString(snapshot.metadata, "renderMode") === "desktop" ? "desktop" : "mobile";
}

function readSnapshotDeviceProfile(snapshot: { metadata?: Record<string, unknown> }) {
  return readSnapshotString(snapshot.metadata, "deviceProfile") === "desktop_default"
    ? "desktop_default"
    : "mobile_default";
}

function safeMetadata(observation: ObservationRecord) {
  try {
    return JSON.parse(observation.metadata_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
