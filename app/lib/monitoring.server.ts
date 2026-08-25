import { buildAnalysisFields } from "~/lib/analysis.server";
import { mapAdSourceToAnalysisSource } from "~/lib/ad-source-kind";
import { type DigestCadence } from "~/lib/change-intelligence";
import { shouldAttemptCreativeTextCapture } from "~/lib/creative-capture-policy";
import { isFullSiteWatchEnabled } from "~/lib/env.server";
import {
  captureCreativeText,
  createMissingCreativeCaptureResult,
} from "~/lib/creative-text.server";
import {
  createAdObservation,
  createEventCandidate,
  createLandingPageSnapshot,
  createProofCapture,
  createWatchEvent,
  createWatchlistRun,
  countProofCapturesForWatchlistSince,
  countProofCapturesForWorkspaceSince,
  finishWatchlistRun,
  recordWatchlistCapacitySkip,
  getRecentSuccessfulRuns,
  getOperatorRiskSummary,
  getSavedQuery,
  countWatchlistRunsForUserSince,
  getWeeklyBusinessSummary,
  hasInFlightWatchlistRun,
  getUserDeliveryProfile,
  getWatchlist,
  hydrateAdsWithPersistedCreatives,
  getDigest,
  listActiveWatchlists,
  listAdsByIds,
  listProofCapturesForTarget,
  listProofCapturesForTargets,
  listRecentWorkspaceProofCaptures,
  listRetryableInstantAttempts,
  listLastSuccessfulProofCapturesForAds,
  listObservationsForRun,
  listWatchEvents,
  listWatchEventsForRun,
  listWatchEventsByIds,
  listWatchlists,
  logMetaIntegrationStatus,
  touchWatchlistScanned,
  upsertProofTarget,
  upsertAd,
} from "~/lib/data.server";
import {
  runDigestDeliveryCycle,
  runDigestDeliveryCycleDetailed,
} from "~/lib/digest-orchestration.server";
import { reportScheduledTaskFailure } from "~/lib/cron-failure-alert.server";
import { deliveryPreDispatchStaleBefore } from "~/lib/delivery-attempt-lease";
import type { AppEnv } from "~/lib/env.server";
import {
  formatScheduledObservationHealthLines,
  listScheduledObservationHealth,
} from "~/lib/scheduled-observation-health.server";
import {
  captureLandingPageSnapshot,
  type LandingPageCaptureFailureDetail,
} from "~/lib/landing-pages.server";
import { compensateUncommittedProofArtifacts } from "~/lib/proof-artifact-retention.server";
import { LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION } from "~/lib/landing-page-signals.server";
import {
  CommercialDiscoveryError,
  resolveCommercialDiscoveryProvider,
  searchAdsViaSourceResolver,
} from "~/lib/ad-source.server";
import { bindD1Named } from "~/lib/d1-bind.server";
import { reportConsecutiveWatchlistFailure } from "~/lib/watchlist-failure-alert.server";
import { normalizeSavedQuery } from "~/lib/normalize";
import { getUserPlan, PLAN_LIMITS } from "~/lib/plan.server";
import { resolveScheduledScanCacheMaxAgeMs } from "~/lib/discovery-cache.server";
import {
  getPlanEntitlements,
  getScheduledMonitoringPolicy,
  parsePlanFamily,
  shouldSchedulePlanInRegularScan,
  shouldScheduleWatchlistInRegularScan,
} from "~/lib/plan-entitlements";
import type { PlanFamily } from "~/lib/plan-entitlements";
import type { BrowserJobPlanTier } from "~/lib/browser-job-telemetry.server";
import { ensureDb } from "~/lib/data/d1.server";
import {
  getEvidenceUsageSummary,
  isEvidenceUsageStorageUnavailableError,
  reconcileStaleEvidenceReservations,
  tryFinalizeEvidenceForProofCapture,
  tryReserveEvidenceForProofCapture,
} from "~/lib/evidence-usage.server";
import {
  buildCanonicalPageIdentity,
  buildProofTargetIdentity,
  countRecentProofFailures,
  evaluateProofPolicy,
  V1_PROOF_BUDGETS,
} from "~/lib/proof-policy.server";
import { normalizePublicHttpUrl } from "~/lib/public-url.server";
import type {
  AdRecord,
  LandingPageSnapshotData,
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
const DISCOVERY_WARMUP_QUERY_LIMIT = 5;
const DIRECT_WEBSITE_PROOF_INTERVAL_MS = 20 * 60 * 60 * 1000;

async function reconcileStaleEvidenceBeforeScan(env: AppEnv) {
  if (!env.DB || typeof env.DB.prepare !== "function") return;
  try {
    // Run the bounded recovery sweep once per scan, before this worker owns
    // any new reservation. Running it per candidate could release a live
    // long-running capture whose 15-minute reservation TTL has elapsed.
    await reconcileStaleEvidenceReservations(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isEvidenceUsageStorageUnavailableError(message)) {
      throw error;
    }
  }
}

type ObservationRecord = Awaited<
  ReturnType<typeof listObservationsForRun>
>[number];

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
  orchestrationRunId?: string;
  orchestrationToken?: string;
  concurrencyPermitToken?: string;
  forceLive?: boolean;
  /** WP-36: reuse shared discovery cache younger than plan cadence. */
  acceptCacheYoungerThanMs?: number;
  /**
   * Resolved plan family of the watchlist owner, recorded in
   * `browser_job_telemetry`. Resolved non-fatally at the scan call sites;
   * null (unknown) on lookup failure.
   */
  planTier?: BrowserJobPlanTier | null;
  /**
   * Real request/worker ExecutionContext when the caller has one (manual
   * refreshes from a route, cron handlers). Threaded into the discovery
   * resolver so slow telemetry row writes are registered with `waitUntil`
   * (background completion, never request latency). Scheduled/workflow
   * surfaces that have no real context omit it — nothing is fabricated.
   */
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
}

export class MonitoringConcurrencyLimitError extends Error {
  constructor() {
    super(
      "Monitoring capacity is full; another scan is already running. Try again shortly.",
    );
    this.name = "MonitoringConcurrencyLimitError";
  }
}

export type {
  MonitoringWorkflowParams,
  ScheduledMonitoringWorkflowParams,
} from "~/lib/monitoring-fanout.server";
export {
  buildWatchlistExecutionIdempotencyKey,
  buildMonitoringWorkflowInstanceId,
} from "~/lib/monitoring-fanout.server";
import type { ScheduledMonitoringWorkflowParams } from "~/lib/monitoring-fanout.server";
import {
  buildWatchlistExecutionIdempotencyKey,
  buildMonitoringWorkflowInstanceId,
  claimMonitoringConcurrencySlot,
  claimOrchestratedWatchlistRun,
  collectMonitoringOrchestrationMetrics,
  dispatchFirstWatchlistScanWorkflow,
  finishOrchestratedWatchlistRun,
  FIRST_SCAN_MAX_ATTEMPTS,
  hasActiveScheduledWatchlistRun,
  hasOrchestratedRunBlockingInlineScan,
  isFanoutEnabledForWorkspace,
  isWatchlistEligibleForScheduledScan,
  markOrchestratedRunCancelled,
  markOrchestratedRunDispatched,
  markOrchestratedDispatchFailure,
  reconcileOrchestratedWatchlistRuns,
  releaseMonitoringConcurrencySlot,
  renewMonitoringConcurrencySlot,
  renewOrchestratedWatchlistRunLease,
  resolveMonitoringFanoutMode,
  resolveMonitoringOrchestrationLeaseMs,
  scheduleWatchlistFanout,
  ensureOrchestratedWatchlistRun,
} from "~/lib/monitoring-fanout.server";

interface RunScheduledMonitoringOptions {
  includeScans?: boolean;
  includeDigests?: boolean;
  cron?: string;
  digestCadence?: DigestCadence;
  digestLookbackDays?: number;
  scheduledTime?: number;
  /**
   * Real Worker ExecutionContext when the cron handler supplies one; threaded
   * into the discovery resolver so slow telemetry row writes get waitUntil
   * background completion. Never fabricated by scheduled surfaces.
   */
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
}

// Cloudflare kills scheduled invocations at the 15-minute wall limit. Stop
// starting new watchlist scans before that so the in-flight scan can finish
// and the kill never silently swallows work.
const SCHEDULED_MONITORING_TIME_BUDGET_MS = 12 * 60 * 1000;

interface RunWeeklyDigestsOptions {
  cadence?: DigestCadence;
  lookbackDays?: number;
  periodEnd?: number | string | Date;
  deadlineAt?: number;
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
      digestAttempts: 0,
      digestFailures: 0,
    };
  }

  const deadlineAt = Date.now() + SCHEDULED_MONITORING_TIME_BUDGET_MS;

  // Digests run BEFORE the scan loop. The digest period ends at the cron's
  // scheduled time, so it never depends on tonight's scan results — and a
  // runtime kill mid-scan can no longer wipe out the day's digests for every
  // user (a digest run that is never created is invisible to the retry sweep).
  const digestResult = options.includeDigests
    ? await runDigestDeliveryCycleDetailed(env, {
        cadence: options.digestCadence ?? "weekly",
        lookbackDays: options.digestLookbackDays,
        periodEnd: options.scheduledTime,
        deadlineAt,
      })
    : { attempted: 0, sent: 0, failed: 0 };

  let queued = 0;
  let duplicates = 0;
  let inlineRuns = 0;
  let inlineFailures = 0;
  let skippedForBudget = 0;
  let skippedForBilling = 0;
  let dispatchFailures = 0;
  let planLookupFailures = 0;

  if (options.includeScans !== false) {
    const listedWatchlists = await listActiveWatchlists(env, {
      includeScout: shouldIncludeScoutInScheduledMonitoring(options),
      includeFree: shouldIncludeFreeInScheduledMonitoring(options),
    });
    const browserAccess = await filterScheduledBrowserWatchlists(
      env,
      listedWatchlists,
    );
    const scheduledTime = options.scheduledTime ?? Date.now();
    // WP-37: agency overflow watchlists only on 6h-aligned slots.
    const priorityScanResult = await filterWatchlistsByPriorityScanSlotsDetailed(
      env,
      browserAccess.watchlists,
      scheduledTime,
    );
    const watchlists = priorityScanResult.watchlists;
    planLookupFailures = priorityScanResult.planLookupFailures;
    skippedForBilling = browserAccess.skipped;

    const fanoutMode = resolveMonitoringFanoutMode(env);

    if (fanoutMode === "inline") {
      const inlineResult = await runScheduledMonitoringInline(
        env,
        watchlists,
        deadlineAt,
        {
          scheduledTime,
          cron: options.cron,
          executionContext: options.executionContext ?? null,
        },
      );
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

      const fanoutResult =
        fanoutWatchlists.length > 0
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
            executionContext: options.executionContext ?? null,
          },
        );
        inlineRuns = inlineResult.inlineRuns;
        inlineFailures += inlineResult.inlineFailures;
        skippedForBudget += inlineResult.skippedForBudget;
      }

      const metrics = await collectMonitoringOrchestrationMetrics(env);
      const { logAppEvent } = await import("~/lib/log.server");
      logAppEvent(
        "info",
        "monitoring_fanout_scheduled",
        "Scheduled monitoring fan-out",
        {
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
        },
      );

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

  if (planLookupFailures > 0) {
    throw new Error(
      `Scheduled monitoring skipped ${planLookupFailures} workspace(s) because plan lookup failed.`,
    );
  }

  return {
    queued,
    duplicates,
    inlineRuns,
    inlineFailures,
    skippedForBudget,
    skippedForBilling,
    dispatchFailures,
    digests: digestResult.sent,
    digestAttempts: digestResult.attempted,
    digestFailures: digestResult.failed,
  };
}

async function filterScheduledBrowserWatchlists(
  env: AppEnv,
  watchlists: WatchlistRecord[],
) {
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

/**
 * WP-37: among each workspace's active watchlists (oldest first), only the
 * first priorityScanSlots run on every plan cadence tick; overflow wait for
 * 6h-aligned runs. Stable ranks use created_at ASC, id ASC.
 */
export async function filterWatchlistsByPriorityScanSlots(
  env: AppEnv,
  watchlists: WatchlistRecord[],
  scheduledTime: number,
): Promise<WatchlistRecord[]> {
  const result = await filterWatchlistsByPriorityScanSlotsDetailed(
    env,
    watchlists,
    scheduledTime,
  );
  return result.watchlists;
}

async function filterWatchlistsByPriorityScanSlotsDetailed(
  env: AppEnv,
  watchlists: WatchlistRecord[],
  scheduledTime: number,
) {
  if (watchlists.length === 0) {
    return { watchlists, planLookupFailures: 0 };
  }

  const scheduledAt = new Date(scheduledTime);
  const byUser = new Map<string, WatchlistRecord[]>();
  for (const watchlist of watchlists) {
    const list = byUser.get(watchlist.userId) ?? [];
    list.push(watchlist);
    byUser.set(watchlist.userId, list);
  }

  const planByUser = new Map<string, PlanFamily>();
  const eligibleIds = new Set<string>();
  let planLookupFailures = 0;

  for (const [userId, userWatchlists] of byUser) {
    let plan = planByUser.get(userId);
    if (!plan) {
      try {
        const raw = (await getUserPlan(env, userId)) as
          | PlanFamily
          | null
          | undefined;
        if (raw == null) {
          planLookupFailures += 1;
          console.error(
            "[monitoring] Plan lookup failed; scheduled scans were skipped for the workspace.",
            {
              workspaceUserId: userId,
              watchlistCount: userWatchlists.length,
              error: new Error("Plan lookup returned no value."),
            },
          );
          continue;
        }
        plan = parsePlanFamily(raw);
      } catch (error) {
        planLookupFailures += 1;
        console.error(
          "[monitoring] Plan lookup failed; scheduled scans were skipped for the workspace.",
          {
            workspaceUserId: userId,
            watchlistCount: userWatchlists.length,
            error,
          },
        );
        continue;
      }
      planByUser.set(userId, plan);
    }

    const ranked = [...userWatchlists].sort((a, b) => {
      const created = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      if (created !== 0) return created;
      return a.id.localeCompare(b.id);
    });

    ranked.forEach((watchlist, rank) => {
      if (
        shouldScheduleWatchlistInRegularScan({
          planFamily: plan!,
          scheduledAt,
          watchlistRank: rank,
        })
      ) {
        eligibleIds.add(watchlist.id);
      }
    });
  }

  return {
    watchlists: watchlists.filter((watchlist) => eligibleIds.has(watchlist.id)),
    planLookupFailures,
  };
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
    return { groups: 0, attempts: 0, failures: 0 };
  }

  const since = new Date(
    Date.now() - INSTANT_ALERT_FLUSH_LOOKBACK_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const pending = await listRetryableInstantAttempts(env, {
    since,
    stalePreDispatchBefore: deliveryPreDispatchStaleBefore(),
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
  let failures = 0;

  for (const [watchlistId, eventIds] of groups) {
    try {
      const watchlist = await getWatchlist(env, watchlistId);
      if (!watchlist || !watchlist.isActive) {
        continue;
      }

      const events = await listWatchEventsByIds(env, watchlistId, [
        ...eventIds,
      ]);
      if (events.length === 0) {
        continue;
      }

      const profile = await getUserDeliveryProfile(env, watchlist.userId);
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
      const delivery = await deliverWatchlistAlerts(env, {
        userId: watchlist.userId,
        userName: profile?.name ?? null,
        accountEmail: profile?.email ?? null,
        watchlist,
        events,
        lane: "customer",
      });

      flushedGroups += 1;
      const alertOutcome = summarizeAlertDelivery(delivery);
      attempts += alertOutcome.attempts;
      failures += alertOutcome.errorCode === "alert_delivery_outcome_invalid"
        ? 1
        : alertOutcome.terminalOutcomes + alertOutcome.pendingOutcomes;
    } catch (error) {
      failures += 1;
      console.error(
        `Instant alert flush failed for watchlist ${watchlistId}; continuing with remaining watchlists.`,
        error,
      );
    }
  }

  return { groups: flushedGroups, attempts, failures };
}

// Runs after scheduled monitoring: when paying customers' scans or
// deliveries are degrading, the operator hears about it instead of finding
// out from a churn email.
export function buildWeeklyBusinessLines(
  summary: Awaited<ReturnType<typeof getWeeklyBusinessSummary>>,
  options: { annualValidationDriftLines?: string[] } = {},
) {
  const paying =
    summary.payingByPlan.length > 0
      ? summary.payingByPlan
          .map((entry) => `${entry.plan}: ${entry.count}`)
          .join(", ")
      : "none yet";
  const digestRate =
    summary.digestAttempts7d > 0
      ? `${Math.round((summary.digestSent7d / summary.digestAttempts7d) * 100)}% (${summary.digestSent7d}/${summary.digestAttempts7d})`
      : "no digests sent";

  const lines = [
    `Signups (7d): ${summary.signups7d} — activated onboarding: ${summary.activated7d}`,
    `Paying customers: ${paying}`,
    `Dunning (payment trouble, plan kept): ${summary.dunningCount}`,
    `Dropped to free (7d, had billing history): ${summary.revokedToFree7d}`,
    `Digest delivery success (7d): ${digestRate}`,
    `Oldest active paid-watchlist scan: ${summary.oldestActivePaidScanAt ?? "n/a"}`,
  ];
  if (options.annualValidationDriftLines?.length) {
    lines.push(...options.annualValidationDriftLines);
  }
  return lines;
}

/** WP-38: surface annual price drift (not 8× monthly) in the operator email. */
export function formatAnnualValidationDriftLines(
  annualValidation:
    | Partial<
        Record<
          "scout" | "starter" | "agency",
          { valid: boolean; reason: string }
        >
      >
    | null
    | undefined,
): string[] {
  if (!annualValidation) {
    return ["Annual validation: unavailable"];
  }
  const drifts: string[] = [];
  for (const plan of ["scout", "starter", "agency"] as const) {
    const entry = annualValidation[plan];
    if (!entry) {
      drifts.push(`${plan}: missing`);
      continue;
    }
    if (!entry.valid) {
      drifts.push(`${plan}: ${entry.reason}`);
    }
  }
  if (drifts.length === 0) {
    return ["Annual validation: ok (pay-8 months)"];
  }
  return [`Annual validation drift: ${drifts.join("; ")}`];
}

export async function sendWeeklyBusinessNumbers(env: AppEnv) {
  if (!env.DB) {
    return { sent: false, reason: "no_db" };
  }

  const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
  const summary = await getWeeklyBusinessSummary(env);
  let scheduledObservationHealthLines = [
    "Scheduled-work heartbeat: unavailable",
  ];
  try {
    scheduledObservationHealthLines = formatScheduledObservationHealthLines(
      await listScheduledObservationHealth(env),
    );
  } catch {
    scheduledObservationHealthLines = [
      "Scheduled-work heartbeat: health read failed",
    ];
  }
  let annualValidationDriftLines: string[] = ["Annual validation: unavailable"];
  try {
    const { previewDodo0509PlanPrices } =
      await import("~/lib/dodo-pricing.server");
    // Operator email is not browser-country scoped; use a stable India request
    // so annual 8× monthly validation still surfaces product/config drift.
    const pricingRequest = new Request("https://0509.io/ops/weekly-business", {
      headers: { "cf-ipcountry": "IN" },
    });
    const preview = await previewDodo0509PlanPrices({
      env,
      request: pricingRequest,
    });
    annualValidationDriftLines = formatAnnualValidationDriftLines(
      preview.annualValidation,
    );
  } catch {
    annualValidationDriftLines = ["Annual validation: preview_failed"];
  }
  const weekStamp = new Date().toISOString().slice(0, 10);
  const idempotencyKey = `business-weekly:${weekStamp}`;
  const sent = await sendOperatorAlertEmail(env, {
    subject: "Five to Nine — weekly business numbers",
    lines: [
      ...buildWeeklyBusinessLines(summary, { annualValidationDriftLines }),
      ...scheduledObservationHealthLines,
    ],
    idempotencyKey,
  });

  if (sent) {
    return { sent: true, reason: "sent" as const };
  }

  try {
    const { getDeliveryAttemptByIdempotencyKey } =
      await import("~/lib/data.server");
    const durableAttempt = await getDeliveryAttemptByIdempotencyKey(
      env,
      idempotencyKey,
    );
    if (durableAttempt?.status === "sent") {
      return { sent: false, reason: "duplicate" as const };
    }
  } catch {
    return { sent: false, reason: "delivery_state_unavailable" as const };
  }

  return { sent: false, reason: "delivery_failed" as const };
}

export async function sendCustomerAtRiskAlert(
  env: AppEnv,
  options: {
    skippedForBudget?: number;
    dispatchFailures?: number;
    inlineFailures?: number;
    digestFailures?: number;
    idempotencyKey?: string;
  } = {},
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
  if ((options.inlineFailures ?? 0) > 0) {
    lines.push(
      `${options.inlineFailures} inline scheduled scan(s) failed before completion.`,
    );
  }
  if ((options.digestFailures ?? 0) > 0) {
    lines.push(
      `${options.digestFailures} scheduled digest(s) failed before delivery.`,
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
    lines.push(
      `${summary.deliveryFailures24h} customer delivery attempt(s) failed in the last 24h.`,
    );
  }
  if (summary.stuckRuns > 0) {
    lines.push(
      `${summary.stuckRuns} watchlist run(s) look stuck (pending/running for over an hour).`,
    );
  }

  if (lines.length === 0) {
    return { sent: false, reason: "all_clear" };
  }

  const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
  const idempotencyKey =
    options.idempotencyKey ??
    `operator-alert:${new Date().toISOString().slice(0, 10)}`;
  const sent = await sendOperatorAlertEmail(env, {
    subject: `0509 customer-at-risk: ${lines.length} signal${lines.length === 1 ? "" : "s"}`,
    lines,
    idempotencyKey,
  });

  if (sent) {
    return { sent: true, reason: "sent" as const, signals: lines.length };
  }

  try {
    const { getDeliveryAttemptByIdempotencyKey } =
      await import("~/lib/data.server");
    const durableAttempt = await getDeliveryAttemptByIdempotencyKey(
      env,
      idempotencyKey,
    );
    if (durableAttempt?.status === "sent") {
      return {
        sent: false,
        reason: "duplicate" as const,
        signals: lines.length,
      };
    }
  } catch {
    return {
      sent: false,
      reason: "delivery_state_unavailable" as const,
      signals: lines.length,
    };
  }

  return {
    sent: false,
    reason: "delivery_failed" as const,
    signals: lines.length,
  };
}

export async function runScheduledDiscoveryWarmup(
  env: AppEnv,
  ctx?: Pick<ExecutionContext, "waitUntil"> | null,
) {
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
    /** Resolved plan family of the watchlist owner (null = unknown). */
    planTier: BrowserJobPlanTier | null;
  }> = [];
  let skipped = 0;

  const sortedWatchlists = [...watchlists].sort((left, right) => {
    const leftTs = left.lastScannedAt
      ? new Date(left.lastScannedAt).getTime()
      : 0;
    const rightTs = right.lastScannedAt
      ? new Date(right.lastScannedAt).getTime()
      : 0;
    return leftTs - rightTs;
  });

  for (const watchlist of sortedWatchlists) {
    const access = await isWatchlistEligibleForScheduledScan(env, watchlist);
    if (!access.eligible) {
      skipped += 1;
      continue;
    }

    // Warmup pre-heats cache for frequent scanners only. Weekly-cadence
    // workspaces (free, and lapsed-paid workspaces whose effective plan is
    // free) must never trigger the 6-hourly live warmup scrape — their Monday
    // scan reuses the shared 7-day cache instead.
    if (access.plan && getPlanEntitlements(access.plan).scheduledScanCadence === "weekly") {
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
    warmupTargets.push({
      watchlist,
      query,
      // The warmup pass already resolved the owner's plan family for the
      // cadence check above — reuse it for telemetry attribution instead of
      // a second non-fatal plan lookup per target.
      planTier: toBrowserJobPlanTier(access.plan),
    });
  }

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  for (const target of warmupTargets) {
    attempted += 1;

    try {
      const response = await searchAdsViaSourceResolver(
        env,
        target.query,
        null,
        {
          purpose: "scheduled_warmup",
          planTier: target.planTier,
          // The cron handler's real Worker ExecutionContext when one is
          // supplied; slow telemetry writes get waitUntil background
          // completion. Never fabricated.
          executionContext: ctx ?? null,
        },
      );
      if (
        response.discoveryStatus === "cache_only" ||
        response.cacheStatus === "stale"
      ) {
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
// weekly, so this is the only scan before the next Monday slot), but a
// per-account daily cap stops a pause/recreate loop from turning watchlist
// creation into unmetered Browser Rendering usage. Paid plans are uncapped
// here.
const FREE_FIRST_SCAN_DAILY_CAP = 3;

const FIRST_SCAN_IDEMPOTENCY_PREFIX = "watchlist-run:first-scan:";

export function firstWatchlistScanExecutionKey(watchlistId: string) {
  return `${FIRST_SCAN_IDEMPOTENCY_PREFIX}${watchlistId}`;
}

/**
 * Atomically reserves one of the free workspace's rolling activation-scan
 * slots. The reservation lives on the durable run so Workflow retries reuse
 * it, while SQLite's write serialization prevents concurrent watchlist adds
 * from either all passing or all being rejected by a read-then-check race.
 */
export async function reserveFirstWatchlistScanDailyQuota(
  env: AppEnv,
  input: {
    runId: string;
    userId: string;
    now?: Date;
    limit?: number;
  },
) {
  const limit = input.limit ?? FREE_FIRST_SCAN_DAILY_CAP;
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const timestamp = now.toISOString();
  const result = await bindD1Named(
    ensureDb(env).prepare(
      `
        UPDATE watchlist_run
        SET summary_json = json_set(
              CASE WHEN json_valid(summary_json) THEN summary_json ELSE '{}' END,
              '$.firstScanQuotaReserved',
              1
            ),
            updated_at = ?
        WHERE id = ?
          AND idempotency_key LIKE 'watchlist-run:first-scan:%'
          AND EXISTS (
            SELECT 1
            FROM watchlist
            WHERE watchlist.id = watchlist_run.watchlist_id
              AND watchlist.user_id = ?
          )
          AND COALESCE(json_extract(summary_json, '$.firstScanQuotaReserved'), 0) <> 1
          AND (
            SELECT COUNT(*)
            FROM watchlist_run AS reserved_run
            INNER JOIN watchlist AS reserved_watchlist
              ON reserved_watchlist.id = reserved_run.watchlist_id
            WHERE reserved_watchlist.user_id = ?
              AND reserved_run.idempotency_key LIKE 'watchlist-run:first-scan:%'
              AND reserved_run.created_at >= ?
              AND COALESCE(
                json_extract(reserved_run.summary_json, '$.firstScanQuotaReserved'),
                0
              ) = 1
          ) < ?
      `,
    ),
    [
      ["firstScanQuota.updatedAt", timestamp],
      ["firstScanQuota.runId", input.runId],
      ["firstScanQuota.userId", input.userId],
      ["firstScanQuota.reservedUserId", input.userId],
      ["firstScanQuota.since", since],
      ["firstScanQuota.limit", limit],
    ],
  ).run();
  if (Number(result.meta?.changes ?? 0) > 0) {
    return true;
  }

  const existing = await bindD1Named(
    ensureDb(env).prepare(
      `
        SELECT COALESCE(json_extract(summary_json, '$.firstScanQuotaReserved'), 0) AS reserved
        FROM watchlist_run
        INNER JOIN watchlist ON watchlist.id = watchlist_run.watchlist_id
        WHERE watchlist_run.id = ?
          AND watchlist.user_id = ?
        LIMIT 1
      `,
    ),
    [
      ["firstScanQuota.runId", input.runId],
      ["firstScanQuota.userId", input.userId],
    ],
  ).first<{ reserved: number }>();
  return Number(existing?.reserved ?? 0) === 1;
}

export interface FirstWatchlistScanRunDescriptor {
  runId: string;
  watchlistId: string;
  executionKey: string;
  workflowInstanceId: string;
  queuedAt: string;
}

export interface FirstWatchlistScanWorkflowParams {
  kind: "first_scan";
  runId: string;
  watchlistId: string;
  executionKey: string;
  workflowInstanceId: string;
  queuedAt: string;
}

async function requeueClaimedFirstWatchlistScan(
  env: AppEnv,
  input: {
    runId: string;
    processingToken: string;
    error: unknown;
  },
) {
  const errorMessage =
    input.error instanceof Error
      ? input.error.message
      : "First scan setup failed.";
  const timestamp = new Date().toISOString();
  const result = await bindD1Named(
    ensureDb(env).prepare(
      `
        UPDATE watchlist_run
        SET status = 'pending',
            error_code = 'first_scan_setup_failed',
            error_message = ?,
            retry_after = ?,
            processing_token = NULL,
            processing_started_at = NULL,
            updated_at = ?
        WHERE id = ?
          AND status = 'running'
          AND processing_token = ?
      `,
    ),
    [
      ["firstScanRequeue.errorMessage", errorMessage],
      ["firstScanRequeue.retryAfter", timestamp],
      ["firstScanRequeue.updatedAt", timestamp],
      ["firstScanRequeue.runId", input.runId],
      ["firstScanRequeue.processingToken", input.processingToken],
    ],
  ).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

const RETRYABLE_FIRST_SCAN_PROVIDER_CODES = new Set([
  "browser_launch_failed",
  "concurrency_limited",
  "rate_limited",
]);
async function readFirstWatchlistScanState(env: AppEnv, runId: string) {
  return bindD1Named(
    ensureDb(env).prepare(
      `
        SELECT status, error_code, attempt_count
        FROM watchlist_run
        WHERE id = ?
        LIMIT 1
      `,
    ),
    [["firstScanState.runId", runId]],
  ).first<{
    status: WatchlistRunRecord["status"];
    error_code: string | null;
    attempt_count: number;
  }>();
}

async function requeueRetryableFirstWatchlistScanFailure(
  env: AppEnv,
  runId: string,
) {
  const state = await readFirstWatchlistScanState(env, runId);
  if (
    state?.status !== "failed" ||
    !state.error_code ||
    !RETRYABLE_FIRST_SCAN_PROVIDER_CODES.has(state.error_code) ||
    state.attempt_count >= FIRST_SCAN_MAX_ATTEMPTS
  ) {
    return false;
  }

  const timestamp = new Date().toISOString();
  const result = await bindD1Named(
    ensureDb(env).prepare(
      `
        UPDATE watchlist_run
        SET status = 'pending',
            finished_at = NULL,
            retry_after = ?,
            processing_token = NULL,
            processing_started_at = NULL,
            updated_at = ?
        WHERE id = ?
          AND status = 'failed'
          AND error_code = ?
          AND attempt_count = ?
      `,
    ),
    [
      ["firstScanRetry.retryAfter", timestamp],
      ["firstScanRetry.updatedAt", timestamp],
      ["firstScanRetry.runId", runId],
      ["firstScanRetry.errorCode", state.error_code],
      ["firstScanRetry.attemptCount", state.attempt_count],
    ],
  ).run();
  return Number(result.meta?.changes ?? 0) > 0;
}

async function assertFirstWatchlistScanWorkflowPayload(
  env: AppEnv,
  params: FirstWatchlistScanWorkflowParams,
) {
  const expectedExecutionKey = firstWatchlistScanExecutionKey(
    params.watchlistId,
  );
  const expectedWorkflowInstanceId = await buildMonitoringWorkflowInstanceId(
    params.executionKey,
  );
  if (
    params.executionKey !== expectedExecutionKey ||
    params.workflowInstanceId !== expectedWorkflowInstanceId
  ) {
    throw new Error(
      "The activation scan Workflow payload identity is invalid.",
    );
  }

  const row = await bindD1Named(
    ensureDb(env).prepare(
      `
        SELECT watchlist_id, idempotency_key, workflow_instance_id
        FROM watchlist_run
        WHERE id = ?
        LIMIT 1
      `,
    ),
    [["firstScanPayload.runId", params.runId]],
  ).first<{
    watchlist_id: string;
    idempotency_key: string | null;
    workflow_instance_id: string | null;
  }>();
  if (
    !row ||
    row.watchlist_id !== params.watchlistId ||
    row.idempotency_key !== params.executionKey ||
    row.workflow_instance_id !== params.workflowInstanceId
  ) {
    throw new Error(
      "The activation scan Workflow payload no longer matches its durable run.",
    );
  }
}

async function finishDeniedFirstWatchlistScan(
  env: AppEnv,
  input: { runId: string; processingToken: string },
) {
  const finalized = await finishOrchestratedWatchlistRun(env, {
    runId: input.runId,
    processingToken: input.processingToken,
    status: "skipped",
    pagesScanned: 0,
    summary: {
      adsSeen: 0,
      events: 0,
      scanStatus: "e2e_provider_network_denied",
      scanErrorCode: "e2e_provider_network_denied",
      scanErrorMessage:
        "The local release proof denied provider network access before the first scan could run.",
    },
    errorCode: "e2e_provider_network_denied",
    errorMessage:
      "The local release proof denied provider network access before the first scan could run.",
  });
  if (!finalized) {
    throw new Error(
      "Stale first-scan claim while recording the provider-network denial.",
    );
  }
}

/**
 * Persist, claim, and execute a first scan from the existing watchlist_run
 * queue. A manual first scan uses the same lease/token fencing as scheduled
 * orchestration, but remains a one-time activation path (not a cadence).
 */
export async function prepareFirstWatchlistScanRun(
  env: AppEnv,
  watchlist: WatchlistRecord,
) {
  const executionKey = firstWatchlistScanExecutionKey(watchlist.id);
  const activeRun = await bindD1Named(
    ensureDb(env).prepare(
      `
        SELECT id
        FROM watchlist_run
        WHERE watchlist_id = ?
          AND status IN ('pending', 'running')
          AND (
            idempotency_key IS NULL
            OR idempotency_key NOT LIKE 'watchlist-run:first-scan:%'
          )
        LIMIT 1
      `,
    ),
    [["firstScanActive.watchlistId", watchlist.id]],
  ).first<{ id: string }>();
  if (activeRun) {
    throw new Error(
      "A scan for this watchlist is already running; activation will retry later.",
    );
  }

  const ensured = await ensureOrchestratedWatchlistRun(env, {
    watchlistId: watchlist.id,
    triggerType: "manual",
    executionKey,
    pageBudget: DEFAULT_PAGE_BUDGET,
    scheduledTime: Date.now(),
    queuePriority: 0,
    allowConcurrentActiveRun: false,
    allowActiveRunFallback: false,
  });

  const row = await bindD1Named(
    ensureDb(env).prepare(
      "SELECT queued_at FROM watchlist_run WHERE id = ? LIMIT 1",
    ),
    [["firstScanQueued.runId", ensured.runId]],
  ).first<{ queued_at: string | null }>();
  return {
    runId: ensured.runId,
    watchlistId: watchlist.id,
    executionKey,
    workflowInstanceId: await buildMonitoringWorkflowInstanceId(executionKey),
    queuedAt: row?.queued_at ?? new Date().toISOString(),
  } satisfies FirstWatchlistScanRunDescriptor;
}

export async function runFirstWatchlistScanWorkflowJob(
  env: AppEnv,
  params: FirstWatchlistScanWorkflowParams,
) {
  await assertFirstWatchlistScanWorkflowPayload(env, params);
  const claim = await claimOrchestratedWatchlistRun(env, {
    runId: params.runId,
    leaseMs: resolveMonitoringOrchestrationLeaseMs(env),
    maxAttempts: FIRST_SCAN_MAX_ATTEMPTS,
  });
  if (!claim.claimed) {
    const state = await readFirstWatchlistScanState(env, params.runId);
    if (state?.status === "pending" || state?.status === "running") {
      throw new Error(
        "The activation scan claim is still owned or exhausted; retry later.",
      );
    }
    return { status: "duplicate" as const, runId: params.runId };
  }

  try {
    const watchlist = await getWatchlist(env, params.watchlistId);
    if (!watchlist || !watchlist.isActive) {
      const finalized = await finishOrchestratedWatchlistRun(env, {
        runId: params.runId,
        processingToken: claim.processingToken,
        status: "skipped",
        pagesScanned: 0,
        summary: { adsSeen: 0, events: 0, scanStatus: "watchlist_unavailable" },
        errorCode: "watchlist_unavailable",
        errorMessage: "This competitor is no longer being tracked.",
      });
      if (!finalized) {
        throw new Error(
          "Stale first-scan claim while recording an unavailable watchlist.",
        );
      }
      return { status: "skipped" as const, runId: params.runId };
    }

    if (watchlist.lastScannedAt) {
      const finalized = await finishOrchestratedWatchlistRun(env, {
        runId: params.runId,
        processingToken: claim.processingToken,
        status: "skipped",
        pagesScanned: 0,
        summary: { adsSeen: 0, events: 0, scanStatus: "already_scanned" },
        errorCode: "already_scanned",
        errorMessage:
          "The activation scan was already completed for this watchlist.",
      });
      if (!finalized) {
        throw new Error(
          "Stale first-scan claim while recording the completed activation scan.",
        );
      }
      return { status: "skipped" as const, runId: params.runId };
    }

    if (env.E2E_PROVIDER_NETWORK_DENY === "1") {
      await finishDeniedFirstWatchlistScan(env, {
        runId: params.runId,
        processingToken: claim.processingToken,
      });
      return { status: "skipped" as const, runId: params.runId };
    }

    const { getUserPlan: readUserPlan } = await import("~/lib/plan.server");
    const plan = await readUserPlan(env, watchlist.userId);
    if (plan === "free") {
      const reserved = await reserveFirstWatchlistScanDailyQuota(env, {
        runId: params.runId,
        userId: watchlist.userId,
      });
      if (!reserved) {
        const finalized = await finishOrchestratedWatchlistRun(env, {
          runId: params.runId,
          processingToken: claim.processingToken,
          status: "skipped",
          pagesScanned: 0,
          summary: {
            adsSeen: 0,
            events: 0,
            scanStatus: "free_first_scan_daily_cap",
          },
          errorCode: "free_first_scan_daily_cap",
          errorMessage:
            "The free activation scan limit was reached for this workspace today.",
        });
        if (!finalized) {
          throw new Error(
            "Stale first-scan claim while recording the free-plan cap.",
          );
        }
        return { status: "skipped" as const, runId: params.runId };
      }
    }

    await runWatchlistManual(env, watchlist, {
      existingRunId: params.runId,
      orchestrationToken: claim.processingToken,
    });
    const state = await readFirstWatchlistScanState(env, params.runId);
    if (await requeueRetryableFirstWatchlistScanFailure(env, params.runId)) {
      throw new Error("The activation scan hit a retryable provider failure.");
    }
    return {
      status:
        state?.status === "failed"
          ? ("failed" as const)
          : ("completed" as const),
      runId: params.runId,
    };
  } catch (error) {
    if (await requeueRetryableFirstWatchlistScanFailure(env, params.runId)) {
      throw error;
    }
    // runWatchlist normally finalizes provider failures as terminal `failed`.
    // This guarded update only requeues a still-running claim, covering every
    // setup failure before that terminal path while fencing stale workers.
    const requeued = await requeueClaimedFirstWatchlistScan(env, {
      runId: params.runId,
      processingToken: claim.processingToken,
      error,
    });
    if (!requeued) {
      const state = await readFirstWatchlistScanState(env, params.runId);
      if (state && ["failed", "skipped", "succeeded"].includes(state.status)) {
        return { status: state.status, runId: params.runId };
      }
    }
    throw error;
  }
}

/** Compatibility helper for callers/tests that execute without a Workflow binding. */
export async function processFirstWatchlistScanQueue(
  env: AppEnv,
  watchlist: WatchlistRecord,
) {
  const descriptor = await prepareFirstWatchlistScanRun(env, watchlist);
  await markOrchestratedRunDispatched(env, {
    runId: descriptor.runId,
    workflowInstanceId: descriptor.workflowInstanceId,
  });
  return runFirstWatchlistScanWorkflowJob(env, {
    kind: "first_scan",
    ...descriptor,
  });
}

export function queueFirstWatchlistScan(
  env: AppEnv,
  ctx: ExecutionContext | undefined,
  watchlist: WatchlistRecord | null | undefined,
) {
  if (!watchlist || watchlist.lastScannedAt) {
    return Promise.resolve(false);
  }

  if (env.DB) {
    return prepareFirstWatchlistScanRun(env, watchlist).then(
      async (descriptor) => {
        const dispatch = await dispatchFirstWatchlistScanWorkflow(
          env,
          descriptor,
        );
        return dispatch.status !== "terminal";
      },
    );
  }

  if (!ctx) {
    return Promise.resolve(false);
  }
  // Non-D1 test/demo environments retain the request-lifetime compatibility
  // path. Production and release-proof environments must use the durable path.
  const work = runFirstWatchlistScanWithPlanCap(env, watchlist);
  ctx.waitUntil(
    work.catch((error) => {
      console.error(
        `First scan failed for watchlist ${watchlist.id}; the scheduled scan will retry.`,
        error,
      );
    }),
  );

  return Promise.resolve(true);
}

async function runFirstWatchlistScanWithPlanCap(
  env: AppEnv,
  watchlist: WatchlistRecord,
) {
  const { getUserPlan } = await import("~/lib/plan.server");
  const plan = await getUserPlan(env, watchlist.userId);
  if (plan === "free") {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentRuns = await countWatchlistRunsForUserSince(
      env,
      watchlist.userId,
      since,
    );
    if (recentRuns >= FREE_FIRST_SCAN_DAILY_CAP) {
      console.warn(
        `First scan skipped for watchlist ${watchlist.id}: free-plan daily first-scan cap reached.`,
      );
      return;
    }
  }
  await runWatchlistManual(env, watchlist);
}

export async function runWatchlistManual(
  env: AppEnv,
  watchlist: WatchlistRecord,
  options: Pick<
    ScanOptions,
    | "existingRunId"
    | "orchestrationToken"
    | "concurrencyPermitToken"
    | "executionContext"
  > = {},
) {
  if (
    watchlist.lastScannedAt &&
    Date.now() - new Date(watchlist.lastScannedAt).getTime() <
      MANUAL_REFRESH_COOLDOWN_MS
  ) {
    throw new Error(
      "This watchlist was refreshed recently. Try again in a few minutes.",
    );
  }

  const customerMetaAdLibraryToken =
    await resolveWatchlistCustomerMetaAdLibraryToken(env, watchlist);

  // First scans and manual/API refreshes do not enter the scheduled queue, but
  // their provider work must still share the same fleet-wide cap. A durable
  // first-scan run supplies its id; ad-hoc refreshes use a unique holder id.
  // The no-D1 compatibility path intentionally keeps its existing behavior.
  let concurrencyPermitToken = options.concurrencyPermitToken;
  let ownsConcurrencyPermit = false;

  try {
    return await runWatchlist(
      env,
      watchlist,
      "manual",
      async () => {
        const query = await resolveWatchlistQuery(env, watchlist);
        if (!query) {
          throw new Error("The watchlist target could not be resolved.");
        }

        // Claim only after runWatchlist's per-watchlist in-flight guard and
        // target resolution have passed. This preserves duplicate behavior and
        // keeps an HTTP refresh responsive when its watchlist is already busy.
        if (
          !concurrencyPermitToken &&
          env.DB &&
          typeof env.DB.prepare === "function"
        ) {
          const capacityRunId =
            options.existingRunId ?? `manual-refresh:${crypto.randomUUID()}`;
          const claim = await claimMonitoringConcurrencySlot(env, {
            runId: capacityRunId,
            mode: "interactive",
          });
          if (!claim.claimed) {
            throw new MonitoringConcurrencyLimitError();
          }
          concurrencyPermitToken = claim.token;
          ownsConcurrencyPermit = true;
        }

        return performBoundedScan(env, query, DEFAULT_PAGE_BUDGET, {
          customerMetaAdLibraryToken,
          orchestrationRunId: options.existingRunId,
          orchestrationToken: options.orchestrationToken,
          concurrencyPermitToken,
          planTier: await resolveBrowserJobPlanTier(env, watchlist.userId),
          executionContext: options.executionContext ?? null,
        });
      },
      {
        customerMetaAdLibraryToken,
        ...options,
      },
    );
  } finally {
    if (ownsConcurrencyPermit && concurrencyPermitToken) {
      await releaseMonitoringConcurrencySlot(env, {
        token: concurrencyPermitToken,
      });
    }
  }
}

export async function runWatchlistWorkflowJob(
  env: AppEnv,
  params: ScheduledMonitoringWorkflowParams,
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

  const customerMetaAdLibraryToken =
    await resolveWatchlistCustomerMetaAdLibraryToken(env, watchlist);
  const acceptCacheYoungerThanMs =
    await resolveScheduledScanSharedCacheMaxAgeMs(env, watchlist.userId);
  if (options.concurrencyPermitToken) {
    await renewMonitoringConcurrencySlot(env, {
      token: options.concurrencyPermitToken,
    });
  }
  await renewOrchestratedWatchlistRunLease(env, {
    runId: params.runId,
    processingToken: claim.processingToken,
  });
  const scanPlanTier = await resolveBrowserJobPlanTier(env, watchlist.userId);
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
          acceptCacheYoungerThanMs,
          planTier: scanPlanTier,
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
        errorMessage:
          error instanceof Error ? error.message : "Retryable scan failure.",
        retryAfterIso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
    }
    throw error;
  }
}

export async function preflightWatchlistWorkflowJob(
  env: AppEnv,
  params: ScheduledMonitoringWorkflowParams,
) {
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
  watchlistId: string,
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
      touchWatchlistId: input.status === "succeeded" ? watchlistId : undefined,
    });
    if (!finalized) {
      throw new StaleOrchestratedWatchlistRunError();
    }
    return;
  }

  await finishWatchlistRun(env, runId, input);
}

const ALERT_DELIVERY_OUTCOMES = new Set([
  "provider_accepted",
  "definitive_terminal_failure",
  "pending_provider_unknown",
  "quiet_deferral",
  "intentional_dedupe",
]);

type CanonicalAlertDeliveryDetail = {
  outcome:
    | "provider_accepted"
    | "definitive_terminal_failure"
    | "pending_provider_unknown"
    | "quiet_deferral"
    | "intentional_dedupe";
  claimedByThisRun: boolean;
  providerAttemptedByThisRun: boolean;
  duplicate: boolean;
  source: "current_claim" | "durable_attempt";
};

function parseAlertDeliveryDetail(value: unknown): CanonicalAlertDeliveryDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const detail = value as Record<string, unknown>;
  if (
    typeof detail.outcome !== "string" ||
    !ALERT_DELIVERY_OUTCOMES.has(detail.outcome) ||
    typeof detail.claimedByThisRun !== "boolean" ||
    typeof detail.providerAttemptedByThisRun !== "boolean" ||
    typeof detail.duplicate !== "boolean" ||
    (detail.source !== "current_claim" && detail.source !== "durable_attempt")
  ) {
    return null;
  }
  const isCurrent = detail.claimedByThisRun === true;
  if (
    detail.duplicate === isCurrent ||
    (isCurrent ? detail.source !== "current_claim" : detail.source !== "durable_attempt") ||
    (detail.outcome === "provider_accepted" &&
      isCurrent &&
      !detail.providerAttemptedByThisRun) ||
    ((detail.outcome === "quiet_deferral" || detail.outcome === "intentional_dedupe") &&
      detail.providerAttemptedByThisRun) ||
    (detail.outcome === "intentional_dedupe" && isCurrent)
  ) {
    return null;
  }
  return detail as CanonicalAlertDeliveryDetail;
}

function invalidAlertDeliverySummary(reason: string) {
  return {
    accepted: 0,
    attempts: 0,
    failures: 0,
    deferrals: 0,
    terminalOutcomes: 0,
    pendingOutcomes: 0,
    errorCode: "alert_delivery_outcome_invalid",
    errorMessage: reason,
  };
}

function summarizeAlertDelivery(delivery: { attempts: number; details?: unknown }) {
  if (!Number.isInteger(delivery.attempts) || delivery.attempts < 0) {
    return invalidAlertDeliverySummary("Alert delivery attempt count is invalid.");
  }
  if (!Array.isArray(delivery.details)) {
    return invalidAlertDeliverySummary("Alert delivery details are missing.");
  }
  if (delivery.details.length !== delivery.attempts) {
    return invalidAlertDeliverySummary("Alert delivery detail cardinality is invalid.");
  }
  const details = delivery.details.map(parseAlertDeliveryDetail);
  if (details.some((detail) => detail === null)) {
    return invalidAlertDeliverySummary("Alert delivery details are malformed or ambiguous.");
  }
  const canonicalDetails = details as CanonicalAlertDeliveryDetail[];
  const current = canonicalDetails.filter((detail) => detail.claimedByThisRun);
  const terminalOutcomes = canonicalDetails.filter(
    (detail) => detail.outcome === "definitive_terminal_failure",
  ).length;
  const pendingOutcomes = canonicalDetails.filter(
    (detail) => detail.outcome === "pending_provider_unknown",
  ).length;
  const errorCode = terminalOutcomes > 0
    ? "alert_delivery_failed"
    : pendingOutcomes > 0
      ? "alert_delivery_pending_provider_unknown"
      : null;
  const errorMessage = terminalOutcomes > 0
    ? `${terminalOutcomes} customer alert delivery outcome${terminalOutcomes === 1 ? "" : "s"} definitively failed.`
    : pendingOutcomes > 0
      ? `${pendingOutcomes} customer alert delivery outcome${pendingOutcomes === 1 ? " is" : "s are"} pending provider confirmation.`
      : null;
  return {
    accepted: current.filter((detail) => detail.outcome === "provider_accepted").length,
    attempts: canonicalDetails.filter((detail) => detail.providerAttemptedByThisRun).length,
    failures: current.filter(
      (detail) => detail.outcome === "definitive_terminal_failure",
    ).length,
    deferrals: current.filter((detail) => detail.outcome === "quiet_deferral").length,
    terminalOutcomes,
    pendingOutcomes,
    errorCode,
    errorMessage,
  };
}

class StaleOrchestratedWatchlistRunError extends Error {
  constructor() {
    super(
      "Stale orchestrated watchlist run token; refusing side effects or finalization.",
    );
    this.name = "StaleOrchestratedWatchlistRunError";
  }
}

class RecordedAlertDeliveryOutcomeError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "RecordedAlertDeliveryOutcomeError";
  }
}

async function assertOrchestratedWatchlistRunLease(
  env: AppEnv,
  runId: string,
  options: ScanOptions,
) {
  if (!options.orchestrationToken) {
    return;
  }
  const renewed = await renewOrchestratedWatchlistRunLease(env, {
    runId,
    processingToken: options.orchestrationToken,
  });
  if (!renewed) {
    throw new StaleOrchestratedWatchlistRunError();
  }
}

function isRetryableMonitoringFailure(error: unknown) {
  if (error instanceof MonitoringConcurrencyLimitError) {
    return true;
  }
  if (error instanceof CommercialDiscoveryError) {
    return (
      error.failureClass === "rate_limited" ||
      error.failureClass === "browser_launch_failed"
    );
  }
  if (error instanceof Error) {
    return /timeout|throttl|temporar|network|concurrency_limited/i.test(
      error.message,
    );
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
        "A scan for this watchlist is already running. Fresh results appear when it completes.",
      );
    }
    // In fan-out mode a queued scheduled run is a live durable claim even if
    // its scheduled slot is older than the short manual-refresh window.
    if (
      resolveMonitoringFanoutMode(env) === "fanout" &&
      (await hasActiveScheduledWatchlistRun(env, watchlist.id))
    ) {
      throw new Error(
        "A scheduled scan for this watchlist is already queued. Fresh results appear when it completes.",
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

    // Provider work can outlive a reclaimed lease. Revalidate before the first
    // durable/customer-facing effect, then heartbeat between each effect
    // phase so an expired worker cannot persist, notify, or finalize.
    await assertOrchestratedWatchlistRunLease(env, runId, options);

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

    const effectLease = options.orchestrationToken
      ? { runId, processingToken: options.orchestrationToken }
      : undefined;

    // Full-Site Watch (feature-flagged): sitemap discovery + bounded crawl +
    // inventory manifest for competitor websites, using the run's lease.
    // Errors are recorded as honest failed manifests, never run-fatal.
    if (isFullSiteWatchEnabled(env)) {
      try {
        await runWebsiteSiteScanForWatchlist(env, watchlist, {
          runId,
          processingToken: options.orchestrationToken ?? null,
          pageBudget: DEFAULT_PAGE_BUDGET,
        });
      } catch (error) {
        console.error(
          `Full-Site Watch scan failed for watchlist ${watchlist.id}; ad scan unaffected.`,
          error,
        );
      }
    }

    await persistCheapScanObservations(env, runId, ads, effectLease);

    const [currentObservations, baselineObservations, priorObservations] =
      await Promise.all([
        listObservationsForRun(env, runId),
        baselineRun
          ? listObservationsForRun(env, baselineRun.id)
          : Promise.resolve([]),
        priorRun
          ? listObservationsForRun(env, priorRun.id)
          : Promise.resolve([]),
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
      effectLease,
      recentWatchEvents,
    );
    await assertOrchestratedWatchlistRunLease(env, runId, options);
    await reconcileStaleEvidenceBeforeScan(env);
    const proofEvaluation = await evaluateSelectiveProofCandidates(env, {
      watchlist,
      runId,
      currentObservations,
      scanNativeDrafts: eventDrafts,
      recentWatchEvents,
      lease: effectLease,
      // Real request ExecutionContext from the caller (manual refresh routes,
      // scheduled handler): proof-capture telemetry rows get waitUntil
      // background completion instead of being dropped by the bounded race.
      executionContext: options.executionContext ?? null,
    });
    const directWebsiteProofEvaluation =
      await evaluateDirectWebsiteProofCandidate(env, {
        watchlist,
        runId,
        recentWatchEvents: [...recentWatchEvents, ...proofEvaluation.events],
        watchlistRunAttemptCount: proofEvaluation.proofAttemptCount,
        lease: effectLease,
        executionContext: options.executionContext ?? null,
      });
    await assertOrchestratedWatchlistRunLease(env, runId, options);
    const newlyEvaluatedEvents = [
      ...scanNativeEvents,
      ...proofEvaluation.events,
      ...directWebsiteProofEvaluation.events,
    ];
    // A Workflow retry may resume after events were persisted but before
    // delivery/finalization. Reload the durable run-owned set so the retry
    // completes the same logical effect instead of silently dropping proof
    // events that now look like recent duplicates.
    const persistedRunEvents = await listWatchEventsForRun(
      env,
      watchlist.id,
      runId,
    );
    const allEvents =
      persistedRunEvents.length > 0 ? persistedRunEvents : newlyEvaluatedEvents;
    const userDeliveryProfile = await getUserDeliveryProfile(
      env,
      watchlist.userId,
    );
    const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
    await assertOrchestratedWatchlistRunLease(env, runId, options);
    const alertDelivery =
      allEvents.length > 0
        ? await deliverWatchlistAlerts(env, {
            userId: watchlist.userId,
            userName: userDeliveryProfile?.name ?? null,
            accountEmail: userDeliveryProfile?.email ?? null,
            watchlist,
            events: allEvents,
            lane: "customer",
          })
        : { attempts: 0, channels: [], details: [] };
    const alertOutcome = summarizeAlertDelivery(alertDelivery);
    const alertDeliveryFailed = alertOutcome.errorCode !== null;

    // WP-25: free users get no digests/instant alerts — send one activation-result
    // email when this run established the baseline (first successful scan).
    await maybeSendFreeActivationResultEmail(env, {
      watchlist,
      runId,
      baselineRunId: baselineRun?.id ?? null,
      events: allEvents,
      adsSeen: currentObservations.length,
      observations: currentObservations,
      userDeliveryProfile,
    });

    await completeWatchlistRun(
      env,
      runId,
      watchlist.id,
      {
        status: alertDeliveryFailed ? "failed" : "succeeded",
        pagesScanned,
        summary: {
          adsSeen: currentObservations.length,
          websiteProofUrl: directWebsiteProofEvaluation.websiteUrl,
          candidatesDetected:
            eventDrafts.length +
            proofEvaluation.candidateCount +
            directWebsiteProofEvaluation.candidateCount,
          proofsAttempted:
            proofEvaluation.proofAttemptCount +
            directWebsiteProofEvaluation.proofAttemptCount,
          eventsConfirmed:
            scanNativeEvents.length +
            proofEvaluation.confirmedEventCount +
            directWebsiteProofEvaluation.confirmedEventCount,
          sendsTriggered: alertOutcome.accepted,
          sendAttempts: alertOutcome.attempts,
          sendFailures: alertOutcome.failures,
          sendDeferrals: alertOutcome.deferrals,
          events: allEvents.length,
          eventTypes: summarizeEventTypes(allEvents),
        },
        errorCode: alertOutcome.errorCode,
        errorMessage: alertOutcome.errorMessage,
      },
      options,
    );
    if (!options.orchestrationToken && !alertDeliveryFailed) {
      await touchWatchlistScanned(env, watchlist.id);
    }
    const commercialProvider = resolveCommercialDiscoveryProvider(env, {
      customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
    });
    await logMetaIntegrationStatus(env, {
      status:
        alertDeliveryFailed
          ? "degraded"
          : commercialProvider === "meta_library_browser"
          ? "healthy"
          : commercialProvider === "meta_api"
            ? "degraded"
            : "demo",
      summary:
        alertDeliveryFailed
          ? "Watchlist evidence completed, but customer alert delivery did not reach a confirmed successful outcome."
          : commercialProvider === "meta_library_browser"
          ? "Scheduled watchlist scan completed through the commercial discovery resolver."
          : commercialProvider === "meta_api"
            ? "Scheduled watchlist scan completed with the diagnostic Meta API path."
            : "Watchlist scan completed in explicit demo mode because no live commercial provider is configured.",
      metadata: {
        watchlistId: watchlist.id,
        runId,
      },
    });

    if (alertOutcome.errorCode !== null) {
      throw new RecordedAlertDeliveryOutcomeError(
        alertOutcome.errorCode,
        alertOutcome.errorMessage ?? "Alert delivery did not reach a confirmed successful outcome.",
      );
    }

    return { runId, events: allEvents.length };
  } catch (error) {
    if (error instanceof RecordedAlertDeliveryOutcomeError) {
      throw error;
    }
    if (error instanceof StaleOrchestratedWatchlistRunError) {
      throw error;
    }
    await assertOrchestratedWatchlistRunLease(env, runId, options);
    const details =
      error instanceof Error ? error.message : "Unknown monitoring error.";
    const errorCode =
      error instanceof CommercialDiscoveryError
        ? error.failureClass
        : error instanceof MonitoringConcurrencyLimitError
          ? "concurrency_limited"
          : "monitoring_failed";
    const directWebsiteUrl = directWebsiteUrlForWatchlist(watchlist);
    const evidenceUsagePendingReconciliation =
      error instanceof Error &&
      error.message === "evidence_usage_pending_reconciliation";

    if (
      directWebsiteUrl &&
      !evidenceUsagePendingReconciliation &&
      !(error instanceof MonitoringConcurrencyLimitError)
    ) {
      const directWebsiteProofEvaluation =
        await evaluateDirectWebsiteProofCandidate(env, {
          watchlist,
          runId,
          recentWatchEvents: await listWatchEvents(env, watchlist.id, 80),
          watchlistRunAttemptCount: 0,
          lease: options.orchestrationToken
            ? { runId, processingToken: options.orchestrationToken }
            : undefined,
          executionContext: options.executionContext ?? null,
        });
      await assertOrchestratedWatchlistRunLease(env, runId, options);
      if (!directWebsiteProofEvaluation.proofCaptureSucceeded) {
        await completeWatchlistRun(
          env,
          runId,
          watchlist.id,
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
              eventTypes: summarizeEventTypes(
                directWebsiteProofEvaluation.events,
              ),
              scanStatus: "failed",
              scanErrorCode: errorCode,
              scanErrorMessage: details,
            },
            errorCode,
            errorMessage: details,
          },
          options,
        );
        await reportConsecutiveWatchlistFailure(env, {
          watchlistId: watchlist.id,
          watchlistName: watchlist.name,
          runId,
          triggerType,
        });
        await logMetaIntegrationStatus(env, {
          status: "degraded",
          summary:
            "Commercial discovery failed and direct website evidence did not complete.",
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

      const userDeliveryProfile = await getUserDeliveryProfile(
        env,
        watchlist.userId,
      );
      const { deliverWatchlistAlerts } = await import("~/lib/delivery.server");
      await assertOrchestratedWatchlistRunLease(env, runId, options);
      const alertDelivery =
        directWebsiteProofEvaluation.events.length > 0
          ? await deliverWatchlistAlerts(env, {
              userId: watchlist.userId,
              userName: userDeliveryProfile?.name ?? null,
              accountEmail: userDeliveryProfile?.email ?? null,
              watchlist,
              events: directWebsiteProofEvaluation.events,
              lane: "customer",
            })
          : { attempts: 0, channels: [], details: [] };
      const alertOutcome = summarizeAlertDelivery(alertDelivery);
      const alertDeliveryFailed = alertOutcome.errorCode !== null;

      await completeWatchlistRun(
        env,
        runId,
        watchlist.id,
        {
          status: alertDeliveryFailed ? "failed" : "succeeded",
          pagesScanned: 0,
          summary: {
            adsSeen: 0,
            websiteProofUrl: directWebsiteProofEvaluation.websiteUrl,
            candidatesDetected: directWebsiteProofEvaluation.candidateCount,
            proofsAttempted: directWebsiteProofEvaluation.proofAttemptCount,
            eventsConfirmed: directWebsiteProofEvaluation.confirmedEventCount,
            sendsTriggered: alertOutcome.accepted,
            sendAttempts: alertOutcome.attempts,
            sendFailures: alertOutcome.failures,
            sendDeferrals: alertOutcome.deferrals,
            events: directWebsiteProofEvaluation.events.length,
            eventTypes: summarizeEventTypes(
              directWebsiteProofEvaluation.events,
            ),
            scanStatus: "degraded",
            scanErrorCode: errorCode,
            scanErrorMessage: details,
          },
          errorCode: alertOutcome.errorCode,
          errorMessage: alertOutcome.errorMessage,
        },
        options,
      );
      if (!options.orchestrationToken && !alertDeliveryFailed) {
        await touchWatchlistScanned(env, watchlist.id);
      }
      await logMetaIntegrationStatus(env, {
        status: "degraded",
        summary:
          alertDeliveryFailed
            ? "Commercial discovery failed; direct website evidence completed, but customer alert delivery did not reach a confirmed successful outcome."
            : "Commercial discovery failed, but direct website evidence still completed.",
        errorCode,
        errorMessage: details,
        metadata: {
          watchlistId: watchlist.id,
          runId,
          websiteProofUrl: directWebsiteProofEvaluation.websiteUrl,
          alertDeliveryAttempts: alertOutcome.attempts,
          alertDeliveryAccepted: alertOutcome.accepted,
          alertDeliveryFailures: alertOutcome.failures,
          alertDeliveryDeferrals: alertOutcome.deferrals,
          alertDeliveryErrorCode: alertOutcome.errorCode,
        },
      });

      if (alertOutcome.errorCode !== null) {
        throw new RecordedAlertDeliveryOutcomeError(
          alertOutcome.errorCode,
          alertOutcome.errorMessage ?? "Alert delivery did not reach a confirmed successful outcome.",
        );
      }

      return { runId, events: directWebsiteProofEvaluation.events.length };
    }

    await completeWatchlistRun(
      env,
      runId,
      watchlist.id,
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
    await reportConsecutiveWatchlistFailure(env, {
      watchlistId: watchlist.id,
      watchlistName: watchlist.name,
      runId,
      triggerType,
    });
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
          advertiser: observation.metadata_json
            ? safeMetadata(observation).advertiser
            : null,
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
          beforeCapturedAt: baselineObservation.seen_at,
          capturedAt: observation.seen_at,
        },
      });
    }

    // WP-28: creative copy refresh — hook/offer are stored on observations but
    // were never diffed. Ride landing_page_headline_changed / offer_changed
    // CHECK types with metadata.kind = "creative_copy".
    const creativeDraft = buildCreativeCopyDraft(
      watchlist,
      adId,
      observation,
      baselineObservation,
    );
    if (creativeDraft) {
      drafts.push(creativeDraft);
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

  return collapseNewAdFlood(dedupeEventDrafts(drafts), watchlist);
}

/** Normalize observation creative fields for equality checks. */
function readObservationCreativeCopy(observation: ObservationRecord) {
  const meta = safeMetadata(observation);
  const hook = typeof meta.hook === "string" ? meta.hook.trim() : "";
  const offer = typeof meta.offer === "string" ? meta.offer.trim() : "";
  return { hook, offer };
}

function buildCreativeCopyDraft(
  watchlist: WatchlistRecord,
  adId: string,
  current: ObservationRecord,
  baseline: ObservationRecord,
): WatchEventDraft | null {
  const from = readObservationCreativeCopy(baseline);
  const to = readObservationCreativeCopy(current);
  // No signal when both sides lack creative text — avoid false diffs from empty↔empty.
  if (!from.hook && !from.offer && !to.hook && !to.offer) {
    return null;
  }
  const hookChanged =
    from.hook !== to.hook && (from.hook.length > 0 || to.hook.length > 0);
  const offerChanged =
    from.offer !== to.offer && (from.offer.length > 0 || to.offer.length > 0);
  if (!hookChanged && !offerChanged) {
    return null;
  }

  // Prefer offer_changed (higher importance) when offer moved; else headline type.
  const eventType = offerChanged
    ? ("landing_page_offer_changed" as const)
    : ("landing_page_headline_changed" as const);
  const advertiser = safeMetadata(current).advertiser;
  const fromLabel = formatCreativeCopyLabel(from);
  const toLabel = formatCreativeCopyLabel(to);

  return {
    eventType,
    adId,
    title: "Ad creative copy changed",
    summary: `The ad creative on ${watchlist.name} was rewritten between scans.`,
    metadata: {
      kind: "creative_copy",
      from: fromLabel,
      to: toLabel,
      hookFrom: from.hook || null,
      hookTo: to.hook || null,
      offerFrom: from.offer || null,
      offerTo: to.offer || null,
      advertiser: typeof advertiser === "string" ? advertiser : null,
      beforeCapturedAt: baseline.seen_at,
      capturedAt: current.seen_at,
    },
  };
}

function formatCreativeCopyLabel(copy: { hook: string; offer: string }) {
  const parts: string[] = [];
  if (copy.hook) parts.push(`Hook: ${copy.hook}`);
  if (copy.offer) parts.push(`Offer: ${copy.offer}`);
  return parts.join(" · ") || "(empty)";
}

/**
 * WP-28: collapse ≥5 raw ad_new drafts into one aggregate event so a big
 * creative launch does not wall the customer with N identical alerts.
 */
function collapseNewAdFlood(
  drafts: WatchEventDraft[],
  watchlist: WatchlistRecord,
): WatchEventDraft[] {
  const newAds = drafts.filter(
    (draft) =>
      draft.eventType === "ad_new" &&
      (draft.metadata as Record<string, unknown> | undefined)?.kind !==
        "baseline" &&
      (draft.metadata as Record<string, unknown> | undefined)?.kind !==
        "ad_new_aggregate" &&
      (draft.metadata as Record<string, unknown> | undefined)?.kind !==
        "creative_copy",
  );
  if (newAds.length < 5) {
    return drafts;
  }

  const other = drafts.filter((draft) => !newAds.includes(draft));
  const adIds = newAds
    .map((draft) => draft.adId)
    .filter((id): id is string => Boolean(id));
  const count = newAds.length;
  return [
    ...other,
    {
      eventType: "ad_new",
      adId: null,
      title: `${count} new ads launched`,
      summary: `${count} new ads entered ${watchlist.name} in this scan.`,
      metadata: {
        kind: "ad_new_aggregate",
        count,
        adIds: adIds.slice(0, 25),
        advertiser:
          newAds
            .map((draft) => draft.metadata?.advertiser)
            .find((value) => typeof value === "string" && value.trim()) ?? null,
      },
    },
  ];
}

export async function runWeeklyDigests(
  env: AppEnv,
  options: RunWeeklyDigestsOptions = {},
) {
  return runDigestDeliveryCycle(env, {
    ...options,
    cadence: "weekly",
    lookbackDays: options.lookbackDays ?? WEEKLY_DIGEST_LOOKBACK_DAYS,
  });
}

export async function runDailyDigests(
  env: AppEnv,
  options: Omit<RunWeeklyDigestsOptions, "cadence"> = {},
) {
  return runDigestDeliveryCycle(env, {
    ...options,
    cadence: "daily",
    lookbackDays: options.lookbackDays ?? DAILY_DIGEST_LOOKBACK_DAYS,
  });
}

function shouldIncludeScoutInScheduledMonitoring(
  options: RunScheduledMonitoringOptions,
) {
  const scheduledAt =
    options.scheduledTime === undefined
      ? new Date()
      : new Date(options.scheduledTime);

  return shouldSchedulePlanInRegularScan("scout", scheduledAt);
}

// Free Weekly Competitor Watch: free watchlists join exactly one tick of the
// regular cron per week (Monday 03:00 UTC — see isWeeklyAlignedScan). Every
// other tick, and the discovery-warmup cron, never lists them.
function shouldIncludeFreeInScheduledMonitoring(options: RunScheduledMonitoringOptions) {
  const scheduledAt = options.scheduledTime === undefined
    ? new Date()
    : new Date(options.scheduledTime);

  return shouldSchedulePlanInRegularScan("free", scheduledAt);
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
    executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
  } = {},
) {
  const scanCache = new Map<string, Promise<ScanPayload>>();
  let inlineRuns = 0;
  let inlineFailures = 0;
  let skippedForBudget = 0;

  for (let index = 0; index < watchlists.length; index += 1) {
    if (Date.now() > deadlineAt) {
      skippedForBudget = watchlists.length - index;
      for (
        let skipIndex = index;
        skipIndex < watchlists.length;
        skipIndex += 1
      ) {
        await recordWatchlistCapacitySkip(env, watchlists[skipIndex]!.id, {
          scheduledTime: options.scheduledTime,
          cron: options.cron,
        });
      }
      break;
    }

    const watchlist = watchlists[index]!;

    try {
      const ranInline = await runScheduledWatchlistInline(
        env,
        watchlist,
        scanCache,
        options,
      );
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
    executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
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
  const durableClaim =
    env.DB &&
    typeof env.DB.prepare === "function" &&
    typeof env.DB.batch === "function"
      ? await claimInlineScheduledWatchlistRun(env, {
          watchlistId: watchlist.id,
          executionKey,
          scheduledTime: options.scheduledTime,
        })
      : null;
  if (durableClaim && !durableClaim.claimed) {
    return false;
  }
  if (
    !durableClaim &&
    ((await hasOrchestratedRunBlockingInlineScan(env, watchlist.id, executionKey)) ||
      (await hasCompletedScheduledInlineScan(
        env,
        watchlist.id,
        options.scheduledTime,
      )))
  ) {
    return false;
  }

  const customerMetaAdLibraryToken =
    await resolveWatchlistCustomerMetaAdLibraryToken(env, watchlist);
  const acceptCacheYoungerThanMs =
    await resolveScheduledScanSharedCacheMaxAgeMs(env, watchlist.userId);
  // In-process dedupe is still per user; cross-workspace reuse is the shared
  // discovery_cache_entry path (acceptCacheYoungerThanMs / WP-36).
  const scanCacheKey = `${watchlist.userId}:${watchlist.targetFingerprint}`;

  const runOptions: ScanOptions = {
    customerMetaAdLibraryToken,
  };
  if (durableClaim?.claimed) {
    runOptions.existingRunId = durableClaim.runId;
    runOptions.orchestrationRunId = durableClaim.runId;
    runOptions.orchestrationToken = durableClaim.processingToken;
  }
  const scanPlanTier = await resolveBrowserJobPlanTier(env, watchlist.userId);

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
            acceptCacheYoungerThanMs,
            planTier: scanPlanTier,
            executionContext: options.executionContext ?? null,
          }),
        );
      }
      return scanCache.get(scanCacheKey)!;
    },
    runOptions,
  );
  return true;
}

async function claimInlineScheduledWatchlistRun(
  env: AppEnv,
  input: {
    watchlistId: string;
    executionKey: string;
    scheduledTime?: number;
  },
) {
  const ensured = await ensureOrchestratedWatchlistRun(env, {
    watchlistId: input.watchlistId,
    triggerType: "scheduled",
    executionKey: input.executionKey,
    pageBudget: DEFAULT_PAGE_BUDGET,
    scheduledTime: input.scheduledTime ?? Date.now(),
    allowActiveRunFallback: false,
  });
  const claim = await claimOrchestratedWatchlistRun(env, {
    runId: ensured.runId,
    leaseMs: resolveMonitoringOrchestrationLeaseMs(env),
  });
  if (!claim.claimed) {
    return { claimed: false as const };
  }
  return {
    claimed: true as const,
    runId: ensured.runId,
    processingToken: claim.processingToken,
  };
}

/**
 * The no-DB fallback cannot persist an execution-key claim. A replay after
 * partial scheduled-work dispatch must therefore recognize the same slot from
 * a successful scheduled run before starting provider work again. Production
 * inline mode uses the durable claim above.
 */
async function hasCompletedScheduledInlineScan(
  env: AppEnv,
  watchlistId: string,
  scheduledTime?: number,
) {
  const scheduledAt = scheduledTime === undefined ? NaN : scheduledTime;
  if (!Number.isFinite(scheduledAt) || scheduledAt > Date.now()) {
    return false;
  }

  const recentRuns = await getRecentSuccessfulRuns(env, watchlistId, 3);
  return recentRuns.some(
    (run) =>
      run.triggerType === "scheduled" &&
      Number.isFinite(Date.parse(run.startedAt)) &&
      Date.parse(run.startedAt) >= scheduledAt,
  );
}

async function resolveScheduledScanSharedCacheMaxAgeMs(
  env: AppEnv,
  userId: string,
): Promise<number | undefined> {
  try {
    const plan = await getUserPlan(env, userId);
    const cadence = getScheduledMonitoringPolicy(plan).scheduledScanCadence;
    return resolveScheduledScanCacheMaxAgeMs(cadence) ?? undefined;
  } catch {
    // Fail open to live scrape rather than reuse with an unknown plan window.
    return undefined;
  }
}

/** Map a resolved plan family to the telemetry tier; null stays unknown. */
function toBrowserJobPlanTier(plan: string | null | undefined): BrowserJobPlanTier | null {
  if (plan === "free" || plan === "scout" || plan === "starter" || plan === "agency") {
    return plan;
  }
  return null;
}

/**
 * Non-fatal plan-family resolution for browser-job telemetry. A plan-lookup
 * blip must never fail a scan; the tier simply stays null (unknown).
 */
async function resolveBrowserJobPlanTier(
  env: AppEnv,
  userId: string,
): Promise<BrowserJobPlanTier | null> {
  try {
    return toBrowserJobPlanTier(await getUserPlan(env, userId));
  } catch {
    return null;
  }
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
        acceptCacheYoungerThanMs: options.acceptCacheYoungerThanMs,
        planTier: options.planTier ?? null,
        executionContext: options.executionContext ?? null,
      },
    );
    ads.push(...response.ads);
    // Cooldown fallbacks serve old cached payloads; diffing them fabricates
    // ad_new/ad_inactive events about ads that never changed.
    if (
      response.discoveryStatus === "cache_only" ||
      response.cacheStatus === "stale"
    ) {
      degraded = true;
    }
    cursor = response.nextCursor;
    pagesScanned += 1;

    if (options.orchestrationRunId && options.orchestrationToken) {
      const renewed = await renewOrchestratedWatchlistRunLease(env, {
        runId: options.orchestrationRunId,
        processingToken: options.orchestrationToken,
      });
      if (!renewed) {
        throw new StaleOrchestratedWatchlistRunError();
      }
    }
    if (options.concurrencyPermitToken) {
      await renewMonitoringConcurrencySlot(env, {
        token: options.concurrencyPermitToken,
      });
    }
  } while (cursor && pagesScanned < pageBudget);

  const hydratedAds = await hydrateAdsWithPersistedCreatives(
    env,
    dedupeAds(ads),
  );

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
    const { getCustomerMetaAdLibraryToken } =
      await import("~/lib/customer-meta.server");
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
  lease?: { runId: string; processingToken: string },
) {
  for (const ad of ads) {
    await assertOrchestratedWatchlistRunLease(env, runId, {
      orchestrationToken: lease?.processingToken,
    });
    const enrichedAd = await enrichAdForCheapScan(env, ad);
    await assertOrchestratedWatchlistRunLease(env, runId, {
      orchestrationToken: lease?.processingToken,
    });
    await upsertAd(env, enrichedAd);

    await assertOrchestratedWatchlistRunLease(env, runId, {
      orchestrationToken: lease?.processingToken,
    });
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
  lease?: { runId: string; processingToken: string },
  recentWatchEvents: WatchEventRecord[] = [],
) {
  const createdEvents: WatchEventRecord[] = [];
  // FIX-2: creative_copy rides high-score types (≥ instant threshold) but
  // dynamic/A-B copy would otherwise re-fire every scan. Suppress identical
  // (adId, from↔to) pairs for 48h either direction.
  const draftsToPersist = filterSuppressedCreativeCopyDrafts(
    drafts,
    recentWatchEvents,
  );

  for (const draft of draftsToPersist) {
    await assertOrchestratedWatchlistRunLease(env, runId, {
      orchestrationToken: lease?.processingToken,
    });
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

    await assertOrchestratedWatchlistRunLease(env, runId, {
      orchestrationToken: lease?.processingToken,
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

async function resolveWorkspaceEvidenceCapacity(
  env: AppEnv,
  workspaceUserId: string,
) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    const userPlan = await getProofCapturePlan(env, workspaceUserId);
    const purchasedProofCredits = 0;
    const workspaceMonthlyCap =
      monthlyProofCapForPlan(userPlan) + purchasedProofCredits;
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
    const workspaceMonthlyCap =
      monthlyProofCapForPlan(userPlan) + purchasedProofCredits;
    const workspaceMonthlyAttempts = await countProofCapturesForWorkspaceSince(
      env,
      workspaceUserId,
      proofWindowStart,
    );
    return {
      userPlan,
      purchasedProofCredits,
      workspaceMonthlyCap,
      workspaceMonthlyRemaining: Math.max(
        0,
        workspaceMonthlyCap - workspaceMonthlyAttempts,
      ),
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
    lease?: { runId: string; processingToken: string };
    /**
     * Real request ExecutionContext when the caller has one; threaded into
     * landing proof captures so telemetry row writes are registered with
     * waitUntil (background completion, never request latency). Scheduled and
     * manual callers without a real context omit it — nothing is fabricated.
     */
    executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
  },
) {
  const proofEvents: WatchEventRecord[] = [];
  const eventTypesByAd = mapEventTypesByAdId(input.scanNativeDrafts);
  const todayStart = startOfUtcDayIso();
  const now = new Date().toISOString();
  const capacity = await resolveWorkspaceEvidenceCapacity(
    env,
    input.watchlist.userId,
  );
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
  const workspaceRecentAttempts = await listRecentWorkspaceProofCaptures(
    env,
    input.watchlist.userId,
    20,
  );
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

    const canonicalPageIdentity = buildCanonicalPageIdentity(
      observation.landing_page_url,
    );
    if (!canonicalPageIdentity) {
      continue;
    }

    const proofTargetIdentity = buildProofTargetIdentity({
      watchlistId: input.watchlist.id,
      adId: observation.ad_id,
      canonicalPageIdentity,
    });
    await assertOrchestratedWatchlistRunLease(env, input.runId, {
      orchestrationToken: input.lease?.processingToken,
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
    new Date(
      Date.now() - V1_PROOF_BUDGETS.targetFailureCooldownMs,
    ).toISOString(),
  );
  const successfulCapturesByAdId = await listLastSuccessfulProofCapturesForAds(
    env,
    input.watchlist.id,
    proofCandidates
      .map((candidate) => candidate.observation.ad_id)
      .filter(Boolean),
    5,
  );

  for (const candidate of proofCandidates) {
    const {
      observation,
      canonicalPageIdentity,
      proofTargetIdentity,
      proofTarget,
    } = candidate;

    const targetCaptures = capturesByTargetId.get(proofTarget.id) ?? [];
    const primaryTriggerEventType =
      eventTypesByAd.get(observation.ad_id)?.[0] ??
      "landing_page_headline_changed";
    const proofRequestKeyBase = buildProofCaptureRequestIdempotencyKey({
      watchlistId: input.watchlist.id,
      adId: observation.ad_id,
      landingPageUrl: observation.landing_page_url!,
      eventType: primaryTriggerEventType,
    });
    const proofRequestKey = [proofRequestKeyBase, input.runId].join(":");
    const replayedProofCapture = targetCaptures.find(
      (capture) =>
        capture.idempotencyKey === proofRequestKey &&
        capture.status === "succeeded",
    );
    const lastSuccessfulProof =
      selectLastSuccessfulProofCapture(
        targetCaptures.filter(
          (capture) => capture.idempotencyKey !== proofRequestKey,
        ),
      ) ??
      selectLastSuccessfulProofCapture(
        (successfulCapturesByAdId.get(observation.ad_id) ?? []).filter(
          (capture) => capture.idempotencyKey !== proofRequestKey,
        ),
      );
    const proofRequestDuplicate = targetCaptures.some((capture) => {
      if (capture.idempotencyKey === proofRequestKey) {
        return false;
      }
      if (
        !matchesProofRequestKey(capture.idempotencyKey, proofRequestKeyBase)
      ) {
        return false;
      }

      return (
        Date.now() - new Date(capture.attemptedAt).getTime() <
        6 * 60 * 60 * 1000
      );
    });
    const recentFailureCountForTarget = countRecentProofFailures(targetCaptures);
    const proofDecision = evaluateProofPolicy({
      sensitivityMode: "balanced",
      triggerEventTypes: eventTypesByAd.get(observation.ad_id) ?? [],
      lastSuccessfulProofAt:
        lastSuccessfulProof?.succeededAt ?? proofTarget.lastSuccessfulProofAt,
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
        await assertOrchestratedWatchlistRunLease(env, input.runId, {
          orchestrationToken: input.lease?.processingToken,
        });
        await createProofCapture(env, {
          proofTargetId: proofTarget.id,
          status: proofDecision.skipReason,
          skipReason: proofDecision.skipReason,
          failureReason: "Evidence policy skipped the attempt.",
          captureMetadata:
            recentFailureCountForTarget >= 2
              ? { unreadableReasonCode: "landing_capture_retry_cooldown" }
              : undefined,
          extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
          idempotencyKey: `${proofRequestKey}:skip:${proofDecision.skipReason}`,
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
      lease: input.lease,
    });

    if (evidenceReservation && !evidenceReservation.result.ok) {
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
      await createProofCapture(env, {
        proofTargetId: proofTarget.id,
        status: "skipped_due_to_budget",
        skipReason: "skipped_due_to_budget",
        failureReason:
          evidenceReservation.result.reason === "top_up_inactive_plan"
            ? "Purchased proof captures require an active paid plan."
            : "Proof capture allowance exhausted.",
        extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        idempotencyKey: `${proofRequestKey}:skip:budget`,
      });
      continue;
    }

    if (evidenceReservation?.result.ok || !evidenceReservation) {
      workspaceMonthlyAttemptCount += 1;
    }

    const evidenceOperationKey =
      evidenceReservation?.logicalOperationKey ?? null;
    let evidenceFinalized = false;
    let preservePendingEvidenceReservation = false;
    let freshSnapshotForCompensation: Awaited<
      ReturnType<typeof captureLandingPageSnapshot>
    > = null;
    let proofCaptureCommitted = false;
    const finalizeEvidence = async (outcome: "succeeded" | "failed") => {
      if (!evidenceOperationKey || evidenceFinalized) return true;
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
      const finalized = await tryFinalizeEvidenceForProofCapture(
        env,
        evidenceOperationKey,
        outcome,
        input.lease,
      );
      evidenceFinalized = finalized;
      return finalized;
    };

    try {
      const replayedSnapshot = proofCaptureToLandingPageSnapshot(
        replayedProofCapture,
        observation.landing_page_url!,
      );
      let captureFailureDetail: LandingPageCaptureFailureDetail | null = null;
      const freshSnapshot = replayedSnapshot
        ? null
        : await captureLandingPageSnapshot(env, observation.landing_page_url!, {
            onFailure: (detail) => {
              captureFailureDetail = detail;
            },
            routeContext: "proof_capture",
            planTier: toBrowserJobPlanTier(capacity.userPlan),
            // Real request ExecutionContext when the caller has one (see
            // `evaluateSelectiveProofCandidates` input).
            executionContext: input.executionContext ?? null,
          });
      const snapshot = replayedSnapshot ?? freshSnapshot;
      const failureDetail =
        captureFailureDetail as LandingPageCaptureFailureDetail | null;
      freshSnapshotForCompensation = freshSnapshot;

      if (!snapshot) {
        if (!(await finalizeEvidence("failed"))) {
          preservePendingEvidenceReservation = true;
          throw new Error("evidence_usage_pending_reconciliation");
        }
        await assertOrchestratedWatchlistRunLease(env, input.runId, {
          orchestrationToken: input.lease?.processingToken,
        });
        await createProofCapture(env, {
          proofTargetId: proofTarget.id,
          status: "failed",
          failureCode:
            failureDetail?.reasonCode ?? "proof_capture_failed",
          failureReason: "Landing-page proof capture failed.",
          captureMetadata: failureDetail
            ? {
                ...failureDetail.metadata,
                unreadableReasonCode: failureDetail.reasonCode,
              }
            : { unreadableReasonCode: "proof_capture_failed" },
          extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
          idempotencyKey: proofRequestKey,
        });
        await assertOrchestratedWatchlistRunLease(env, input.runId, {
          orchestrationToken: input.lease?.processingToken,
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
        buildCanonicalPageIdentity(snapshot.canonicalUrl) ??
        canonicalPageIdentity;
      const finalProofTargetIdentity = buildProofTargetIdentity({
        watchlistId: input.watchlist.id,
        adId: observation.ad_id,
        canonicalPageIdentity: finalCanonicalPageIdentity,
      });
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
      const persistedProofTarget =
        (await upsertProofTarget(env, {
          watchlistId: input.watchlist.id,
          adId: observation.ad_id,
          landingPageUrl: snapshot.canonicalUrl,
          canonicalPageIdentity: finalCanonicalPageIdentity,
          proofTargetIdentity: finalProofTargetIdentity,
        })) ?? proofTarget;
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
      // Persist a fresh capture as a versioned landing_page_snapshot row.
      // Replayed captures (freshSnapshot === null) reuse an existing proof
      // capture and must not append a duplicate snapshot row.
      const landingPageSnapshotId = freshSnapshot
        ? await persistLandingPageSnapshotRow(env, freshSnapshot)
        : null;
      const proofCaptureId = await createProofCapture(env, {
        proofTargetId: persistedProofTarget.id,
        status: "succeeded",
        screenshotArtifactKey: readSnapshotString(
          snapshot.metadata,
          "screenshotArtifactKey",
        ),
        htmlArtifactKey:
          readSnapshotString(snapshot.metadata, "htmlArtifactKey") ??
          snapshot.artifactKey ??
          null,
        extractedFields,
        fieldConfidence,
        extractionWarnings,
        captureMetadata: {
          ...(snapshot.metadata ?? {}),
          ...(landingPageSnapshotId
            ? { landingPageSnapshotId }
            : {}),
        },
        renderMode: readSnapshotRenderMode(snapshot),
        deviceProfile: readSnapshotDeviceProfile(snapshot),
        extractorVersion:
          readSnapshotString(snapshot.metadata, "extractorVersion") ??
          LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        idempotencyKey: proofRequestKey,
        attemptedAt: snapshot.capturedAt,
        succeededAt: snapshot.capturedAt,
      });
      proofCaptureCommitted = true;
      if (!(await finalizeEvidence("succeeded"))) {
        preservePendingEvidenceReservation = true;
        throw new Error("evidence_usage_pending_reconciliation");
      }
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
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
          extractorVersion:
            readSnapshotString(snapshot.metadata, "extractorVersion") ??
            LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        },
        lastSuccessfulProof,
        recentWatchEvents: proofAwareRecentEvents,
        sensitivityMode: "balanced",
        burstCount: (eventTypesByAd.get(observation.ad_id) ?? []).length,
        currentCapturedAt: snapshot.capturedAt,
      });

      for (const event of evaluated.events) {
        await assertOrchestratedWatchlistRunLease(env, input.runId, {
          orchestrationToken: input.lease?.processingToken,
        });
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

        await assertOrchestratedWatchlistRunLease(env, input.runId, {
          orchestrationToken: input.lease?.processingToken,
        });
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
    } catch (error) {
      if (freshSnapshotForCompensation && !proofCaptureCommitted) {
        const compensated = await compensateUncommittedProofArtifacts(
          env,
          freshSnapshotForCompensation,
        );
        if (!compensated.ok)
          throw new Error("proof_artifact_compensation_incomplete", {
            cause: error,
          });
      }
      if (!preservePendingEvidenceReservation) {
        await assertOrchestratedWatchlistRunLease(env, input.runId, {
          orchestrationToken: input.lease?.processingToken,
        });
        await finalizeEvidence("failed");
      }
      throw error;
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
    lease?: { runId: string; processingToken: string };
    /**
     * Real request ExecutionContext when the caller has one; threaded into
     * the landing proof capture so telemetry row writes are registered with
     * waitUntil (background completion, never request latency). Callers
     * without a real context omit it — nothing is fabricated.
     */
    executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
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
  const capacity = await resolveWorkspaceEvidenceCapacity(
    env,
    input.watchlist.userId,
  );
  const userPlan = capacity.userPlan;
  const purchasedProofCredits = capacity.purchasedProofCredits;
  const workspaceMonthlyCap = capacity.workspaceMonthlyCap;
  const workspaceDailyCap = capacity.workspaceDailyCap;
  const [
    watchlistDailyAttempts,
    workspaceDailyAttempts,
    workspaceMonthlyAttempts,
  ] = await Promise.all([
    countProofCapturesForWatchlistSince(env, input.watchlist.id, todayStart),
    countProofCapturesForWorkspaceSince(
      env,
      input.watchlist.userId,
      todayStart,
    ),
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
  await assertOrchestratedWatchlistRunLease(env, input.runId, {
    orchestrationToken: input.lease?.processingToken,
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

  const targetCaptures = await listProofCapturesForTarget(
    env,
    proofTarget.id,
    20,
    new Date(
      Date.now() - V1_PROOF_BUDGETS.targetFailureCooldownMs,
    ).toISOString(),
  );
  const proofRequestKeyBase = buildProofCaptureRequestIdempotencyKey({
    watchlistId: input.watchlist.id,
    adId: null,
    landingPageUrl: websiteUrl,
    eventType: "landing_page_offer_changed",
  });
  const proofRequestKey = [proofRequestKeyBase, input.runId].join(":");
  const replayedProofCapture = targetCaptures.find(
    (capture) =>
      capture.idempotencyKey === proofRequestKey &&
      capture.status === "succeeded",
  );
  const lastSuccessfulProof = selectLastSuccessfulProofCapture(
    targetCaptures.filter(
      (capture) => capture.idempotencyKey !== proofRequestKey,
    ),
  );
  const proofRequestDuplicate = targetCaptures.some((capture) => {
    if (capture.idempotencyKey === proofRequestKey) {
      return false;
    }
    if (!matchesProofRequestKey(capture.idempotencyKey, proofRequestKeyBase)) {
      return false;
    }

    return (
      Date.now() - new Date(capture.attemptedAt).getTime() < 6 * 60 * 60 * 1000
    );
  });
  const recentFailureCountForTarget = countRecentProofFailures(targetCaptures);

  if (
    isWithinDirectWebsiteProofInterval(
      lastSuccessfulProof?.succeededAt ?? proofTarget.lastSuccessfulProofAt,
    )
  ) {
    return emptyProofEvaluation(websiteUrl);
  }

  if (proofRequestDuplicate) {
    await assertOrchestratedWatchlistRunLease(env, input.runId, {
      orchestrationToken: input.lease?.processingToken,
    });
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "skipped_due_to_dedupe",
      skipReason: "skipped_due_to_dedupe",
      failureReason: "Direct website evidence was already requested recently.",
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
      idempotencyKey: `${proofRequestKey}:skip:dedupe`,
    });
    return emptyProofEvaluation(websiteUrl);
  }

  if (
    input.watchlistRunAttemptCount >= V1_PROOF_BUDGETS.perWatchlistRun ||
    recentFailureCountForTarget >= 2
  ) {
    await assertOrchestratedWatchlistRunLease(env, input.runId, {
      orchestrationToken: input.lease?.processingToken,
    });
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "skipped_due_to_rate_limit",
      skipReason: "skipped_due_to_rate_limit",
      failureReason: "Direct website evidence policy skipped the attempt.",
      captureMetadata: {
        unreadableReasonCode:
          recentFailureCountForTarget >= 2
            ? "landing_capture_retry_cooldown"
            : "proof_run_rate_limit",
      },
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
      idempotencyKey: `${proofRequestKey}:skip:rate-limit`,
    });
    return emptyProofEvaluation(websiteUrl);
  }

  const evidenceReservation = await tryReserveEvidenceForProofCapture(env, {
    workspaceUserId: input.watchlist.userId,
    proofTargetId: proofTarget.id,
    idempotencyKey: proofRequestKey,
    source: "monitoring.direct_website",
    lease: input.lease,
  });

  if (evidenceReservation && !evidenceReservation.result.ok) {
    await assertOrchestratedWatchlistRunLease(env, input.runId, {
      orchestrationToken: input.lease?.processingToken,
    });
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "skipped_due_to_budget",
      skipReason: "skipped_due_to_budget",
      failureReason:
        evidenceReservation.result.reason === "top_up_inactive_plan"
          ? "Purchased proof captures require an active paid plan."
          : "Proof capture allowance exhausted.",
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
      idempotencyKey: `${proofRequestKey}:skip:budget`,
    });
    return emptyProofEvaluation(websiteUrl);
  }

  if (capacity.workspaceMonthlyRemaining <= 0 && !evidenceReservation) {
    await assertOrchestratedWatchlistRunLease(env, input.runId, {
      orchestrationToken: input.lease?.processingToken,
    });
    await createProofCapture(env, {
      proofTargetId: proofTarget.id,
      status: "skipped_due_to_budget",
      skipReason: "skipped_due_to_budget",
      failureReason: "Proof capture allowance exhausted.",
      extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
      idempotencyKey: `${proofRequestKey}:skip:budget`,
    });
    return emptyProofEvaluation(websiteUrl);
  }

  const evidenceOperationKey = evidenceReservation?.logicalOperationKey ?? null;
  let evidenceFinalized = false;
  let preservePendingEvidenceReservation = false;
  let freshSnapshotForCompensation: Awaited<
    ReturnType<typeof captureLandingPageSnapshot>
  > = null;
  let proofCaptureCommitted = false;
  const finalizeEvidence = async (outcome: "succeeded" | "failed") => {
    if (!evidenceOperationKey || evidenceFinalized) return true;
    await assertOrchestratedWatchlistRunLease(env, input.runId, {
      orchestrationToken: input.lease?.processingToken,
    });
    const finalized = await tryFinalizeEvidenceForProofCapture(
      env,
      evidenceOperationKey,
      outcome,
      input.lease,
    );
    evidenceFinalized = finalized;
    return finalized;
  };

  try {
    const replayedSnapshot = proofCaptureToLandingPageSnapshot(
      replayedProofCapture,
      websiteUrl,
    );
    let captureFailureDetail: LandingPageCaptureFailureDetail | null = null;
    const freshSnapshot = replayedSnapshot
      ? null
      : await captureLandingPageSnapshot(env, websiteUrl, {
          preferRendered: true,
          onFailure: (detail) => {
            captureFailureDetail = detail;
          },
          routeContext: "proof_capture",
          planTier: toBrowserJobPlanTier(capacity.userPlan),
          // Real request ExecutionContext when the caller has one (see
          // `evaluateDirectWebsiteProofCandidate` input).
          executionContext: input.executionContext ?? null,
        });
    const snapshot = replayedSnapshot ?? freshSnapshot;
    const failureDetail =
      captureFailureDetail as LandingPageCaptureFailureDetail | null;
    freshSnapshotForCompensation = freshSnapshot;

    if (!snapshot) {
      if (!(await finalizeEvidence("failed"))) {
        preservePendingEvidenceReservation = true;
        throw new Error("evidence_usage_pending_reconciliation");
      }
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
      await createProofCapture(env, {
        proofTargetId: proofTarget.id,
        status: "failed",
        failureCode:
          failureDetail?.reasonCode ??
          "direct_website_proof_capture_failed",
          failureReason: "Competitor website proof capture failed.",
        captureMetadata: {
          ...(failureDetail?.metadata ?? {}),
          source: "direct_competitor_website",
          watchlistTargetId: input.watchlist.targetId,
          unreadableReasonCode:
            failureDetail?.reasonCode ??
            "direct_website_proof_capture_failed",
        },
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
      buildCanonicalPageIdentity(snapshot.canonicalUrl) ??
      canonicalPageIdentity;
    const finalProofTargetIdentity = buildProofTargetIdentity({
      watchlistId: input.watchlist.id,
      adId: null,
      canonicalPageIdentity: finalCanonicalPageIdentity,
    });
    await assertOrchestratedWatchlistRunLease(env, input.runId, {
      orchestrationToken: input.lease?.processingToken,
    });
    const persistedProofTarget =
      (await upsertProofTarget(env, {
        watchlistId: input.watchlist.id,
        adId: null,
        landingPageUrl: snapshot.canonicalUrl,
        canonicalPageIdentity: finalCanonicalPageIdentity,
        proofTargetIdentity: finalProofTargetIdentity,
        lastCaptureAttemptAt: snapshot.capturedAt,
      })) ?? proofTarget;
    const finalTargetCaptures = await listProofCapturesForTarget(
      env,
      persistedProofTarget.id,
      20,
    );
    const finalProofRequestKey = [
      buildProofCaptureRequestIdempotencyKey({
        watchlistId: input.watchlist.id,
        adId: null,
        landingPageUrl: snapshot.canonicalUrl,
        eventType: "landing_page_offer_changed",
      }),
      input.runId,
    ].join(":");
    const finalLastSuccessfulProof =
      selectLastSuccessfulProofCapture(
        finalTargetCaptures.filter(
          (capture) => capture.idempotencyKey !== finalProofRequestKey,
        ),
      ) ?? lastSuccessfulProof;
    // Persist a fresh capture as a versioned landing_page_snapshot row.
    // Replayed captures (freshSnapshot === null) reuse an existing proof
    // capture and must not append a duplicate snapshot row.
    const landingPageSnapshotId = freshSnapshot
      ? await persistLandingPageSnapshotRow(env, freshSnapshot)
      : null;
    const proofCaptureId = await createProofCapture(env, {
      proofTargetId: persistedProofTarget.id,
      status: "succeeded",
      screenshotArtifactKey: readSnapshotString(
        snapshot.metadata,
        "screenshotArtifactKey",
      ),
      htmlArtifactKey:
        readSnapshotString(snapshot.metadata, "htmlArtifactKey") ??
        snapshot.artifactKey ??
        null,
      extractedFields,
      fieldConfidence: readSnapshotConfidence(snapshot),
      extractionWarnings: readSnapshotWarnings(snapshot),
      captureMetadata: {
        ...(snapshot.metadata ?? {}),
        source: "direct_competitor_website",
        watchlistTargetId: input.watchlist.targetId,
        ...(landingPageSnapshotId ? { landingPageSnapshotId } : {}),
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
    proofCaptureCommitted = true;
    if (!(await finalizeEvidence("succeeded"))) {
      preservePendingEvidenceReservation = true;
      throw new Error("evidence_usage_pending_reconciliation");
    }
    await assertOrchestratedWatchlistRunLease(env, input.runId, {
      orchestrationToken: input.lease?.processingToken,
    });
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
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
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
        extractorVersion:
          readSnapshotString(snapshot.metadata, "extractorVersion") ??
          LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
      },
      lastSuccessfulProof: finalLastSuccessfulProof,
      recentWatchEvents: input.recentWatchEvents,
      sensitivityMode: "balanced",
      burstCount: 1,
      currentCapturedAt: snapshot.capturedAt,
    });

    const proofEvents: WatchEventRecord[] = [];
    let candidateCount = 0;
    let confirmedEventCount = 0;

    for (const event of evaluated.events) {
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
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

      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
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
  } catch (error) {
    if (freshSnapshotForCompensation && !proofCaptureCommitted) {
      const compensated = await compensateUncommittedProofArtifacts(
        env,
        freshSnapshotForCompensation,
      );
      if (!compensated.ok)
        throw new Error("proof_artifact_compensation_incomplete", {
          cause: error,
        });
    }
    if (!preservePendingEvidenceReservation) {
      await assertOrchestratedWatchlistRunLease(env, input.runId, {
        orchestrationToken: input.lease?.processingToken,
      });
      await finalizeEvidence("failed");
    }
    throw error;
  }
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

/**
 * Full-Site Watch: run sitemap discovery + bounded crawl + inventory writes
 * for one competitor watchlist under the current run's processing-token
 * lease. Only advertiser watchlists with a public website URL participate.
 * The discovery/crawl module owns all durability; failures surface as honest
 * failed manifests (inventory_complete = false) instead of exceptions.
 */
async function runWebsiteSiteScanForWatchlist(
  env: AppEnv,
  watchlist: WatchlistRecord,
  options: {
    runId: string;
    processingToken: string | null;
    pageBudget: number;
  },
) {
  const websiteUrl = directWebsiteUrlForWatchlist(watchlist);
  if (!websiteUrl) {
    return null;
  }
  if (!options.processingToken) {
    // The lease-fenced scan layer requires a processing token; without one
    // (manual refresh) the site scan is skipped rather than written unfenced.
    return null;
  }

  const { runWebsiteSiteScan } = await import("~/lib/competitor-site-monitor.server");
  return runWebsiteSiteScan(env, {
    lease: {
      watchlistId: watchlist.id,
      runId: options.runId,
      processingToken: options.processingToken,
    },
    rootUrl: websiteUrl,
    pageBudget: options.pageBudget,
  });
}

function isWithinDirectWebsiteProofInterval(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();
  return (
    Number.isFinite(timestamp) &&
    Date.now() - timestamp < DIRECT_WEBSITE_PROOF_INTERVAL_MS
  );
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
    normalizeIdempotencySegment(
      normalizeIdempotencyUrl(input.landingPageUrl) ?? "none",
    ),
  ].join(":");
}

function matchesProofRequestKey(
  idempotencyKey: string | null | undefined,
  requestKeyBase: string,
) {
  return Boolean(
    idempotencyKey &&
    (idempotencyKey === requestKeyBase ||
      idempotencyKey.startsWith(`${requestKeyBase}:`)),
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
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function enrichAdForCheapScan(env: AppEnv, ad: AdRecord) {
  const creativeSourceUrl =
    ad.adSnapshotUrl?.trim() || ad.creativeImageUrl?.trim() || null;
  const capturedCreativeText =
    shouldAttemptCreativeTextCapture(ad)
      ? creativeSourceUrl
        ? await captureCreativeText(env, creativeSourceUrl, ad)
        : createMissingCreativeCaptureResult(ad)
      : null;

  const nextAd = {
    ...ad,
    creativeText: capturedCreativeText?.text ?? ad.creativeText ?? null,
    creativeImageUrl:
      capturedCreativeText?.imageUrl ?? ad.creativeImageUrl ?? null,
    creativeTextCaptureMethod:
      capturedCreativeText?.captureMethod ??
      ad.creativeTextCaptureMethod ??
      null,
    creativeTextMetadata:
      capturedCreativeText?.metadata ?? ad.creativeTextMetadata ?? null,
  };

  return ensureAnalysisFields(nextAd);
}

function ensureAnalysisFields(ad: AdRecord): AdRecord {
  return {
    ...ad,
    analysisFields: buildAnalysisFields(
      ad,
      mapAdSourceToAnalysisSource(ad.source),
    ),
  };
}

function mapObservationsByAdId(observations: ObservationRecord[]) {
  return new Map(
    observations.map((observation) => [observation.ad_id, observation]),
  );
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

const CREATIVE_COPY_SUPPRESSION_MS = 48 * 60 * 60 * 1000;

function creativeCopyPairKey(from: string, to: string): string {
  const a = from.trim().toLowerCase();
  const b = to.trim().toLowerCase();
  return a <= b ? `${a}↔${b}` : `${b}↔${a}`;
}

function isCreativeCopyDraft(draft: WatchEventDraft): boolean {
  return draft.metadata?.kind === "creative_copy";
}

/** FIX-2: drop creative_copy drafts seen (either direction) within 48h for the ad. */
export function filterSuppressedCreativeCopyDrafts(
  drafts: WatchEventDraft[],
  recentEvents: Array<{
    adId: string | null;
    createdAt: string;
    metadata: Record<string, unknown> | null;
  }>,
  nowMs: number = Date.now(),
): WatchEventDraft[] {
  const cutoff = nowMs - CREATIVE_COPY_SUPPRESSION_MS;
  const recentKeys = new Set<string>();

  for (const event of recentEvents) {
    if (new Date(event.createdAt).getTime() < cutoff) continue;
    const metadata = event.metadata ?? {};
    if (metadata.kind !== "creative_copy") continue;
    const from = typeof metadata.from === "string" ? metadata.from : "";
    const to = typeof metadata.to === "string" ? metadata.to : "";
    recentKeys.add(`${event.adId ?? "none"}:${creativeCopyPairKey(from, to)}`);
  }

  return drafts.filter((draft) => {
    if (!isCreativeCopyDraft(draft)) return true;
    const from =
      typeof draft.metadata.from === "string" ? draft.metadata.from : "";
    const to = typeof draft.metadata.to === "string" ? draft.metadata.to : "";
    const key = `${draft.adId ?? "none"}:${creativeCopyPairKey(from, to)}`;
    if (recentKeys.has(key)) return false;
    recentKeys.add(key);
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
  // FIX-6(b): route through the evaluator map so WP-20 ad_new:76 is live.
  switch (eventType) {
    case "landing_page_url_changed":
    case "landing_page_headline_changed":
    case "ad_new":
    case "ad_inactive":
    case "landing_page_offer_changed":
    case "landing_page_cta_changed":
    case "landing_page_form_changed":
      return scoreWatchEventImportance({
        eventType,
        proofPresent: true,
        sensitivityMode: "balanced",
        burstCount: 1,
        purchaseSignals: false,
      });
    default:
      return 50;
  }
}

function startOfUtcDayIso() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function startOfRollingProofWindowIso() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

// Daily proof ceilings sized so each plan's marketed monthly number is
// actually reachable (cap*30 > monthly), with purchased credit packs adding
// a smoothed daily allowance without expiring the underlying top-up balance.
const DAILY_PROOF_CAP_BY_PLAN: Record<string, number> = {
  // Free carries one evidence check per month (the activation scan's
  // proof-backed brief); the daily cap must not starve that single capture.
  free: 1,
  scout: 20,
  starter: 40,
  agency: 120,
};

export function dailyProofCapForPlan(plan: string, purchasedCredits: number) {
  const base =
    DAILY_PROOF_CAP_BY_PLAN[plan] ?? V1_PROOF_BUDGETS.perWorkspaceDay;
  return base + Math.ceil(Math.max(0, purchasedCredits) / 30);
}

function monthlyProofCapForPlan(plan: string) {
  const cap =
    PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS]?.proofCapturesPerMonth;
  return typeof cap === "number" ? cap : Number.POSITIVE_INFINITY;
}

async function getProofCapturePlan(env: AppEnv, userId: string) {
  // Prefer the real plan row when D1 is bound.
  if (env.DB && typeof env.DB.prepare === "function") {
    return getUserPlan(env, userId);
  }

  // No D1: never invent Starter capacity (WP-38 fail-closed). If a plan
  // lookup still resolves to an explicit paid family (unit-test mocks), honor
  // it; otherwise free (0 daily proof budget).
  try {
    const plan = await getUserPlan(env, userId);
    if (plan === "scout" || plan === "starter" || plan === "agency") {
      return plan;
    }
  } catch {
    // fall through
  }
  return "free";
}

async function sumActiveProofUsageCredits(
  env: AppEnv,
  userId: string,
  grantedSince: string,
  now: string,
) {
  if (!env.DB || typeof env.DB.prepare !== "function") return 0;

  try {
    const result = await bindD1Named(
      env.DB.prepare(
        `
          SELECT COALESCE(SUM(credits), 0) AS total
          FROM proof_usage_credit
          WHERE user_id = ?
            AND granted_at >= ?
            AND expires_at > ?
        `,
      ),
      [
        ["proofUsageCredit.userId", userId],
        ["proofUsageCredit.grantedSince", grantedSince],
        ["proofUsageCredit.now", now],
      ],
    ).all<{ total: number }>();
    return Number(result.results?.[0]?.total ?? 0);
  } catch (error) {
    if (
      /proof_usage_credit|no such table/i.test(
        error instanceof Error ? error.message : String(error),
      )
    ) {
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

function proofCaptureToLandingPageSnapshot(
  capture: ProofCaptureRecord | undefined,
  fallbackUrl: string,
): LandingPageSnapshotData | null {
  if (!capture || capture.status !== "succeeded") {
    return null;
  }
  const readString = (key: string) => {
    const value = capture.extractedFields[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const rawHeadline = readString("rawHeadline");
  const normalizedHeadline = readString("normalizedHeadline");
  const normalizedHeadlineHash = readString("normalizedHeadlineHash");
  if (!rawHeadline || !normalizedHeadline || !normalizedHeadlineHash) {
    return null;
  }
  const canonicalUrl = readString("canonicalUrl") ?? fallbackUrl;
  const formPresent = capture.extractedFields.formPresent;
  return {
    rawUrl: fallbackUrl,
    canonicalUrl,
    rawHeadline,
    normalizedHeadline,
    normalizedHeadlineHash,
    ctaText: readString("ctaText"),
    priceText: readString("priceText"),
    formPresent: typeof formPresent === "boolean" ? formPresent : null,
    captureMethod: "manual",
    capturedAt: capture.succeededAt ?? capture.attemptedAt,
    artifactKey: capture.htmlArtifactKey,
    metadata: {
      ...capture.captureMetadata,
      screenshotArtifactKey: capture.screenshotArtifactKey,
      htmlArtifactKey: capture.htmlArtifactKey,
      extractorVersion: capture.extractorVersion,
      replayedFromDurableCapture: true,
    },
  };
}

/**
 * Persist a fresh landing-page capture as a versioned `landing_page_snapshot`
 * row (headline, CTA, price, form-present, artifact key, capture-validity
 * state in metadata). Additive and never throws: a snapshot-row write failure
 * is logged and swallowed so the monitoring run still records its proof
 * capture and events. Returns the new snapshot id, or null when the row could
 * not be persisted. Only called for fresh captures — replayed captures reuse
 * an existing proof capture and must not append a duplicate snapshot row.
 */
async function persistLandingPageSnapshotRow(
  env: AppEnv,
  snapshot: LandingPageSnapshotData,
): Promise<string | null> {
  try {
    return await createLandingPageSnapshot(env, snapshot);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "landing_page_snapshot_persist_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return null;
  }
}

function readSnapshotString(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readSnapshotConfidence(snapshot: {
  metadata?: Record<string, unknown>;
}) {
  const confidence = snapshot.metadata?.extractedFieldConfidence;
  if (
    !confidence ||
    typeof confidence !== "object" ||
    Array.isArray(confidence)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(confidence).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function readSnapshotWarnings(snapshot: {
  metadata?: Record<string, unknown>;
}) {
  const warnings = snapshot.metadata?.extractionWarnings;
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.filter(
    (warning): warning is string => typeof warning === "string",
  );
}

function readSnapshotRenderMode(snapshot: {
  metadata?: Record<string, unknown>;
}) {
  return readSnapshotString(snapshot.metadata, "renderMode") === "desktop"
    ? "desktop"
    : "mobile";
}

function readSnapshotDeviceProfile(snapshot: {
  metadata?: Record<string, unknown>;
}) {
  return readSnapshotString(snapshot.metadata, "deviceProfile") ===
    "desktop_default"
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

/**
 * WP-25 free activation-result email. Only on the first successful scan
 * (no prior baseline run) for free-plan workspaces. Paid plans already get
 * digests/instant alerts; free has neither. Failures never fail the scan.
 */
async function maybeSendFreeActivationResultEmail(
  env: AppEnv,
  input: {
    watchlist: WatchlistRecord;
    runId: string;
    baselineRunId: string | null;
    events: WatchEventRecord[];
    adsSeen: number;
    observations: ObservationRecord[];
    userDeliveryProfile: Awaited<ReturnType<typeof getUserDeliveryProfile>>;
  },
) {
  const profile = input.userDeliveryProfile;
  if (!profile?.email || profile.emailVerified !== true) {
    return;
  }

  try {
    const plan = await getUserPlan(env, input.watchlist.userId);
    if (plan !== "free") {
      return;
    }

    // Prefer an honest baseline event when present; still email if the scan
    // succeeded with zero ads (honest empty baseline — useful signal).
    const hasBaselineEvent = input.events.some(
      (event) =>
        ((event.metadata ?? {}) as Record<string, unknown>).kind === "baseline",
    );
    if (
      !shouldAttemptFreeActivationResult(
        input.baselineRunId,
        hasBaselineEvent,
        input.adsSeen,
      )
    ) {
      return;
    }

    const adIds = input.observations
      .map((observation) => observation.ad_id)
      .filter((adId): adId is string => Boolean(adId))
      .slice(0, 8);
    const adsById =
      adIds.length > 0
        ? new Map(
            (await listAdsByIds(env, adIds)).map((ad) => [ad.metaAdId, ad]),
          )
        : new Map<string, AdRecord>();

    const topAds = input.observations.slice(0, 3).map((observation) => {
      const meta = safeMetadata(observation);
      const ad = observation.ad_id ? adsById.get(observation.ad_id) : null;
      const hook =
        typeof meta.hook === "string" ? meta.hook : (ad?.hook ?? null);
      const offer =
        typeof meta.offer === "string" ? meta.offer : (ad?.offer ?? null);
      const body = ad?.body ?? offer ?? null;
      return {
        headline: hook,
        body,
        creativeImageUrl: ad?.creativeImageUrl ?? null,
      };
    });

    const { sendFreeActivationResultEmail } =
      await import("~/lib/delivery.server");
    const result = await sendFreeActivationResultEmail(env, {
      userId: input.watchlist.userId,
      email: profile.email,
      name: profile.name ?? null,
      watchlistId: input.watchlist.id,
      competitorName: input.watchlist.name,
      adsFound: input.adsSeen,
      topAds,
      // Honest proof claim: only when a confirmed event is attached to a
      // succeeded capture. A scan can complete with zero ads, or the landing
      // capture can fail, and the email must not claim a proof-backed brief
      // that does not exist.
      proofCaptureSucceeded: input.events.some(
        (event) => Boolean(event.proofCaptureId) && event.status === "confirmed",
      ),
    });
    if (
      !result.sent &&
      result.reason !== "duplicate" &&
      result.reason !== "unsubscribed" &&
      result.reason !== "missing_email"
    ) {
      await reportScheduledTaskFailure(
        env,
        "free_activation_result_delivery",
        new Error(`activation result email was not sent: ${result.reason}`),
      );
    }
  } catch (error) {
    // Activation email must never roll back a successful scan.
    await reportScheduledTaskFailure(env, "free_activation_result_delivery", error);
  }
}

export function shouldAttemptFreeActivationResult(
  baselineRunId: string | null,
  hasBaselineEvent: boolean,
  adsSeen: number,
) {
  // Later successful scans re-enter the delivery claim so a missing or
  // definite failed first-result attempt gets another owner. The claim's
  // idempotency key prevents a second provider call after acceptance.
  return Boolean(baselineRunId) || hasBaselineEvent || adsSeen === 0;
}
