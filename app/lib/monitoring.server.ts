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
  getDigestByPeriod,
  getRecentSuccessfulRuns,
  getSavedQuery,
  getUserDeliveryProfile,
  getWatchlist,
  hydrateAdsWithPersistedCreatives,
  listActiveWatchlists,
  listProofCapturesForTarget,
  listRecentWorkspaceProofCaptures,
  listSuccessfulProofCapturesForAd,
  listObservationsForRun,
  listWatchEvents,
  listWatchEventsBetween,
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
import {
  buildCanonicalPageIdentity,
  buildProofTargetIdentity,
  evaluateProofPolicy,
} from "~/lib/proof-policy.server";
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
const DISCOVERY_WARMUP_QUERY_LIMIT = 5;

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
}

interface ScanOptions {
  customerMetaAdLibraryToken?: string | null;
}

export interface MonitoringWorkflowParams {
  watchlistId: string;
  triggerType: WatchlistRunRecord["triggerType"];
  executionKey: string;
  proofCaptureRequestKeyPrefix: string;
  queuedAt: string;
}

interface RunScheduledMonitoringOptions {
  includeDigests?: boolean;
  cron?: string;
  digestCadence?: DigestCadence;
  digestLookbackDays?: number;
  scheduledTime?: number;
}

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
    return { queued: 0, duplicates: 0, inlineRuns: 0, digests: 0 };
  }

  const watchlists = await listActiveWatchlists(env);
  let queued = 0;
  let duplicates = 0;
  let inlineRuns = 0;

  const workflowBinding = getMonitoringWorkflowBinding(env);
  const shouldBypassWorkflow = shouldRunScheduledMonitoringInline(env);

  if (workflowBinding && !shouldBypassWorkflow) {
    const scheduledTime = options.scheduledTime ?? Date.now();
    const scanCache = new Map<string, Promise<ScanPayload>>();

    for (const watchlist of watchlists) {
      const executionKey = buildWatchlistExecutionIdempotencyKey({
        watchlistId: watchlist.id,
        triggerType: "scheduled",
        scheduledTime,
        cron: options.cron,
      });

      try {
        await workflowBinding.create({
          id: executionKey,
          params: {
            watchlistId: watchlist.id,
            triggerType: "scheduled",
            executionKey,
            proofCaptureRequestKeyPrefix: `proof:${executionKey}`,
            queuedAt: new Date(scheduledTime).toISOString(),
          },
        });
        queued += 1;
      } catch (error) {
        if (isDuplicateWorkflowCreateError(error)) {
          duplicates += 1;
          continue;
        }

        const ranInline = await runScheduledWatchlistInline(env, watchlist, scanCache);
        inlineRuns += ranInline ? 1 : 0;
      }
    }
  } else {
    inlineRuns = await runScheduledMonitoringInline(env, watchlists);
  }

  const digests = options.includeDigests
    ? await runDigests(env, {
        cadence: options.digestCadence ?? "weekly",
        lookbackDays: options.digestLookbackDays,
        periodEnd: options.scheduledTime,
      })
    : 0;

  return {
    queued,
    duplicates,
    inlineRuns,
    digests,
  };
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
    (async () => {
      const query = await resolveWatchlistQuery(env, watchlist);
      if (!query) {
        throw new Error("The watchlist target could not be resolved.");
      }
      return performBoundedScan(env, query, DEFAULT_PAGE_BUDGET, {
        customerMetaAdLibraryToken,
      });
    })(),
    {
      customerMetaAdLibraryToken,
    },
  );
}

export async function runWatchlistWorkflowJob(
  env: AppEnv,
  params: MonitoringWorkflowParams,
) {
  const watchlist = await getWatchlist(env, params.watchlistId);
  if (!watchlist || !watchlist.isActive) {
    return {
      status: "skipped" as const,
      reason: "watchlist_unavailable",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  const query = await resolveWatchlistQuery(env, watchlist);
  if (!query) {
    return {
      status: "skipped" as const,
      reason: "watchlist_target_unresolved",
      watchlistId: params.watchlistId,
      executionKey: params.executionKey,
    };
  }

  const customerMetaAdLibraryToken = await resolveWatchlistCustomerMetaAdLibraryToken(env, watchlist);
  const result = await runWatchlist(
    env,
    watchlist,
    params.triggerType,
    performBoundedScan(env, query, DEFAULT_PAGE_BUDGET, {
      customerMetaAdLibraryToken,
    }),
    {
      customerMetaAdLibraryToken,
    },
  );

  return {
    status: "completed" as const,
    executionKey: params.executionKey,
    proofCaptureRequestKeyPrefix: params.proofCaptureRequestKeyPrefix,
    ...result,
  };
}

export async function runWatchlist(
  env: AppEnv,
  watchlist: WatchlistRecord,
  triggerType: WatchlistRunRecord["triggerType"],
  scanPromise: Promise<ScanPayload>,
  options: ScanOptions = {},
) {
  const recentRuns = await getRecentSuccessfulRuns(env, watchlist.id, 3);
  const baselineRun = recentRuns[0] ?? null;
  const priorRun = recentRuns[1] ?? null;
  const runId = await createWatchlistRun(
    env,
    watchlist.id,
    triggerType,
    baselineRun?.id ?? null,
    DEFAULT_PAGE_BUDGET,
  );

  try {
    const { ads, pagesScanned } = await scanPromise;
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
    const allEvents = [...scanNativeEvents, ...proofEvaluation.events];
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

    await finishWatchlistRun(env, runId, {
      status: "succeeded",
      pagesScanned,
      summary: {
        adsSeen: currentObservations.length,
        candidatesDetected: eventDrafts.length + proofEvaluation.candidateCount,
        proofsAttempted: proofEvaluation.proofAttemptCount,
        eventsConfirmed: scanNativeEvents.length + proofEvaluation.confirmedEventCount,
        sendsTriggered: alertDelivery.attempts,
        events: allEvents.length,
        eventTypes: summarizeEventTypes(allEvents),
      },
    });
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

    await finishWatchlistRun(env, runId, {
      status: "failed",
      pagesScanned: 0,
      summary: {
        adsSeen: 0,
        events: 0,
      },
      errorCode,
      errorMessage: details,
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
          advertiser: observation.metadata_json ? safeMetadata(observation).advertiser : null,
        },
      });
      continue;
    }

    if (
      observation.landing_page_url &&
      baselineObservation.landing_page_url &&
      observation.landing_page_url !== baselineObservation.landing_page_url
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

  for (const user of users) {
    const plan = await getUserPlan(env, user.id);
    if (!PLAN_LIMITS[plan].digests) {
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

    for (const watchlist of watchlists) {
      const events = await listWatchEventsBetween(
        env,
        watchlist.id,
        periodStartIso,
        periodEndIso,
      );

      for (const event of events.filter(isCustomerDigestEligibleEvent)) {
        digestItems.push({
          eventId: event.id,
          watchlistId: watchlist.id,
          watchlistName: watchlist.name,
          eventType: event.eventType,
          title: event.title,
          summary: event.summary,
          metadata: digestMetadataForEvent(event),
        });
      }
    }

    if (digestItems.length === 0) {
      continue;
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
  }

  return digestsSent;
}

async function resolveWatchlistQuery(env: AppEnv, watchlist: WatchlistRecord) {
  if (watchlist.targetType === "advertiser") {
    return normalizeSavedQuery("advertiser", {
      query: watchlist.targetLabel,
      country: "India",
    });
  }

  const savedQuery = await getSavedQuery(env, watchlist.targetId);
  return savedQuery?.normalizedQuery ?? null;
}

function shouldRunScheduledMonitoringInline(env: AppEnv) {
  // Browser-backed discovery currently needs the main Worker runtime so the
  // Browser binding stays available during the scheduled scan.
  return resolveCommercialDiscoveryProvider(env) === "meta_library_browser";
}

async function runScheduledMonitoringInline(
  env: AppEnv,
  watchlists: WatchlistRecord[],
) {
  const scanCache = new Map<string, Promise<ScanPayload>>();
  let inlineRuns = 0;

  for (const watchlist of watchlists) {
    const ranInline = await runScheduledWatchlistInline(env, watchlist, scanCache);
    inlineRuns += ranInline ? 1 : 0;
  }

  return inlineRuns;
}

async function runScheduledWatchlistInline(
  env: AppEnv,
  watchlist: WatchlistRecord,
  scanCache: Map<string, Promise<ScanPayload>>,
) {
  const query = await resolveWatchlistQuery(env, watchlist);
  if (!query) {
    return false;
  }

  const customerMetaAdLibraryToken = await resolveWatchlistCustomerMetaAdLibraryToken(env, watchlist);
  const scanCacheKey = `${watchlist.userId}:${watchlist.targetFingerprint}`;

  if (!scanCache.has(scanCacheKey)) {
    scanCache.set(
      scanCacheKey,
      performBoundedScan(env, query, DEFAULT_PAGE_BUDGET, {
        customerMetaAdLibraryToken,
      }),
    );
  }

  await runWatchlist(
    env,
    watchlist,
    "scheduled",
    scanCache.get(scanCacheKey)!,
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
  const ads: AdRecord[] = [];

  do {
    const response = await searchAdsViaSourceResolver(
      env,
      query,
      cursor ?? null,
      {
        purpose: "watchlist_scan",
        customerMetaAdLibraryToken: options.customerMetaAdLibraryToken ?? null,
      },
    );
    ads.push(...response.ads);
    cursor = response.nextCursor;
    pagesScanned += 1;
  } while (cursor && pagesScanned < pageBudget);

  const hydratedAds = await hydrateAdsWithPersistedCreatives(env, dedupeAds(ads));

  return {
    ads: hydratedAds,
    pagesScanned,
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
) {
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
  const workspaceRecentAttempts = await listRecentWorkspaceProofCaptures(env, input.watchlist.userId, 20);
  const proofAwareRecentEvents = [...input.recentWatchEvents];
  let watchlistRunAttemptCount = 0;
  let watchlistDailyAttemptCount = watchlistDailyAttempts;
  let workspaceDailyAttemptCount = workspaceDailyAttempts;
  let candidateCount = 0;
  let proofAttemptCount = 0;
  let confirmedEventCount = 0;

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

    const targetCaptures = await listProofCapturesForTarget(env, proofTarget.id, 20);
    const lastSuccessfulProof =
      selectLastSuccessfulProofCapture(targetCaptures) ??
      (await getLastSuccessfulProofForAd(env, input.watchlist.id, observation.ad_id));
    const primaryTriggerEventType =
      eventTypesByAd.get(observation.ad_id)?.[0] ?? "landing_page_headline_changed";
    const proofRequestKey = buildProofCaptureRequestIdempotencyKey({
      watchlistId: input.watchlist.id,
      adId: observation.ad_id,
      landingPageUrl: observation.landing_page_url,
      eventType: primaryTriggerEventType,
    });
    const proofRequestDuplicate = targetCaptures.some((capture) => {
      if (!capture.idempotencyKey || capture.idempotencyKey !== proofRequestKey) {
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
      workspaceRecentAttempts,
      activeCaptureCount: 0,
      burstCount: input.currentObservations.length,
      proofRequestDuplicate,
      recentFailureCountForTarget,
    });

    if (!proofDecision.shouldCapture) {
      if (proofDecision.skipReason) {
        await createProofCapture(env, {
          proofTargetId: proofTarget.id,
          status: proofDecision.skipReason,
          skipReason: proofDecision.skipReason,
          failureReason: "Proof policy skipped the attempt.",
          extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        });
      }
      continue;
    }

    watchlistRunAttemptCount += 1;
    watchlistDailyAttemptCount += 1;
    workspaceDailyAttemptCount += 1;
    proofAttemptCount += 1;
    const snapshot = await captureLandingPageSnapshot(env, observation.landing_page_url);

    if (!snapshot) {
      await createProofCapture(env, {
        proofTargetId: proofTarget.id,
        status: "failed",
        failureCode: "proof_capture_failed",
        failureReason: "Landing page proof capture failed.",
        extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
        idempotencyKey: proofRequestKey,
      });
      await upsertProofTarget(env, {
        watchlistId: input.watchlist.id,
        adId: observation.ad_id,
        landingPageUrl: observation.landing_page_url,
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
      burstCount: input.currentObservations.length,
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

export function buildWatchlistExecutionIdempotencyKey(input: {
  watchlistId: string;
  triggerType: WatchlistRunRecord["triggerType"];
  scheduledTime?: number;
  cron?: string | null;
}) {
  const slot = new Date(input.scheduledTime ?? Date.now())
    .toISOString()
    .replace(/[:.]/g, "-");
  const cronFragment = normalizeIdempotencySegment(input.cron ?? "adhoc");
  return `watchlist-run:${input.triggerType}:${input.watchlistId}:${cronFragment}:${slot}`;
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

function getMonitoringWorkflowBinding(env: AppEnv) {
  return env.MONITORING_WORKFLOW as Workflow<MonitoringWorkflowParams> | undefined;
}

function isDuplicateWorkflowCreateError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /already exists|already been created|instance .* exists|duplicate/i.test(
    error.message.toLowerCase(),
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

async function getLastSuccessfulProofForAd(
  env: AppEnv,
  watchlistId: string,
  adId: string,
): Promise<ProofCaptureRecord | null> {
  const captures = await listSuccessfulProofCapturesForAd(env, watchlistId, adId, 5);
  return selectLastSuccessfulProofCapture(captures);
}

function startOfUtcDayIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
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
