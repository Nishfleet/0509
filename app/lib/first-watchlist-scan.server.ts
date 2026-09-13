// The free-tier activation scan ("first scan") queue, extracted from
// `~/lib/monitoring.server` (issue #2614). A move, not a rewrite: the
// scheduled-cadence and manual-scan machinery stays in monitoring.server.
import {
  countWatchlistRunsForUserSince,
  getWatchlist,
} from "~/lib/data.server";
import { ensureDb } from "~/lib/data/d1.server";
import { bindD1Named } from "~/lib/d1-bind.server";
import type { AppEnv } from "~/lib/env.server";
import type { PlanFamily } from "~/lib/plan-entitlements";
import type {
  PresenceConnectorId,
  PresenceTrackingMode,
} from "~/lib/presence-types";
import {
  buildMonitoringWorkflowInstanceId,
  claimOrchestratedWatchlistRun,
  dispatchFirstWatchlistScanWorkflow,
  ensureOrchestratedWatchlistRun,
  finishOrchestratedWatchlistRun,
  FIRST_SCAN_MAX_ATTEMPTS,
  markOrchestratedRunDispatched,
  resolveMonitoringOrchestrationLeaseMs,
} from "~/lib/monitoring-fanout.server";
import type {
  WatchlistRecord,
  WatchlistRunRecord,
} from "~/lib/types";

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
  /**
   * Optional activation reason carried through to the Workflow payload for
   * observability. `signup_first_brief` marks the BET 7 same-session capture
   * queued from onboarding (issue #1276). Absent for the default activation
   * path. No D1 column carries this — it is a Workflow-param-only signal.
   */
  reason?: "signup_first_brief";
}

export interface FirstWatchlistScanWorkflowParams {
  kind: "first_scan";
  runId: string;
  watchlistId: string;
  executionKey: string;
  workflowInstanceId: string;
  queuedAt: string;
  /** See {@link FirstWatchlistScanRunDescriptor.reason}. */
  reason?: "signup_first_brief";
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
  options?: { reason?: "signup_first_brief" },
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
    // Lazy: keeps the scheduled-scan machinery in ~/lib/monitoring.server out
    // of the route module graph (the pre-extraction behaviour for route
    // importers was a dynamic import at call time).
    pageBudget: (await import("~/lib/monitoring.server")).DEFAULT_PAGE_BUDGET,
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
    ...(options?.reason ? { reason: options.reason } : {}),
  } satisfies FirstWatchlistScanRunDescriptor;
}

/**
 * A mention source target the activation fan-out will poll (#3176, epic
 * #3172). `sourceId` is the `source_target` row id, which is also the
 * `sourceProgress` map key — unique per target, so two targets of the same
 * connector never overwrite each other's ticks.
 */
interface ActivationMentionTarget {
  sourceId: string;
  connectorId: PresenceConnectorId;
  label: string;
  trackingMode: PresenceTrackingMode;
}

/**
 * Enumerate the workspace's tracked mention sources (#3171) for the
 * activation fan-out. Only what actually exists is planned: a workspace with
 * no tracked entities (the free signup until #3179 lands self-tracking) fans
 * out across the ad libraries alone — honest, never padded.
 */
async function listActivationMentionTargets(
  env: AppEnv,
  userId: string,
): Promise<ActivationMentionTarget[]> {
  const { listTrackedEntities, listSourceTargetsForEntity } = await import(
    "~/lib/presence-data.server"
  );
  const { SOURCE_LABELS } = await import("~/lib/presence-source-coverage.server");
  const entities = await listTrackedEntities(env, userId);
  const targets: ActivationMentionTarget[] = [];
  for (const entity of entities) {
    if (!entity.isActive) continue;
    const sourceTargets = await listSourceTargetsForEntity(env, userId, entity.id);
    for (const sourceTarget of sourceTargets) {
      targets.push({
        sourceId: sourceTarget.id,
        connectorId: sourceTarget.connectorId,
        label:
          (SOURCE_LABELS as Record<string, string | undefined>)[
            sourceTarget.connectorId
          ] ?? sourceTarget.connectorId,
        trackingMode: entity.trackingMode,
      });
    }
  }
  return targets;
}

/**
 * #3176: write the fan-out's pending denominator before the first source
 * ticks — every enabled seam source (the #2992 ad libraries the owner's plan
 * enables, the exact set `runSources` will run) plus every tracked mention
 * source target (#3171). The onboard page reads this subtree off the run row
 * as the "scanning N sources" denominator. Progress is observability, never
 * correctness: a planning failure hides the block, never the scan.
 */
async function planActivationScanSources(
  env: AppEnv,
  watchlist: WatchlistRecord,
  plan: PlanFamily,
  runId: string,
): Promise<void> {
  try {
    const { planScanSources } = await import("~/lib/scan-source-progress.server");
    const { getEnabledSources } = await import("~/lib/sources/registry.server");
    const seamSources = getEnabledSources(env, plan).map((adapter) => ({
      sourceId: adapter.id,
      kind: "ad_library" as const,
      label: adapter.label,
    }));
    const mentionSources = (await listActivationMentionTargets(env, watchlist.userId)).map(
      (target) => ({
        sourceId: target.sourceId,
        kind: "mention" as const,
        label: target.label,
      }),
    );
    await planScanSources(env, runId, [...seamSources, ...mentionSources]);
  } catch (error) {
    console.log("activation scan-source planning failed (progress hidden)", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * #3176: poll one mention source target inside the activation fan-out.
 * The capture itself rides the EXISTING customer poll path
 * (`pollPresenceSourceTarget`) — plan gates, the per-source rollout kill
 * flag, the capture-validity gate (#2873) and dedup are all those checks;
 * this leg adds only the progress tick and the per-source wall-clock budget.
 * A killed or gated connector is ticked `skipped` without burning its
 * budget; a degraded poll result is ticked `failed` with the poll path's own
 * error code (nothing is fabricated past the validity gate).
 */
async function captureOneActivationMentionSource(
  env: AppEnv,
  userId: string,
  runId: string,
  target: ActivationMentionTarget,
  options: { fetchImpl?: typeof fetch },
): Promise<void> {
  const { recordScanSourceTick, SCAN_SOURCE_BUDGET_MS, withScanSourceBudget } =
    await import("~/lib/scan-source-progress.server");
  const tick = (
    status: Parameters<typeof recordScanSourceTick>[3]["status"],
    detail?: string | null,
  ) =>
    recordScanSourceTick(env, runId, target.sourceId, {
      kind: "mention",
      label: target.label,
      status,
      detail: detail ?? null,
    });

  // Per-source kill flag / customer-poll path: the same posture
  // `runPresencePollingBatch` uses. A connector that is not operational for
  // customer polling never runs.
  const { connectorOperationalForPolling } = await import(
    "~/lib/presence-access-gates.server"
  );
  if (
    !(await connectorOperationalForPolling(
      env,
      target.connectorId,
      target.trackingMode,
      userId,
    ))
  ) {
    await tick("skipped", "connector_not_operational");
    return;
  }

  await tick("running");
  const { pollPresenceSourceTarget } = await import("~/lib/presence-service.server");
  // #3176 per-source budget: a hung source loses the race, is ticked
  // `timed_out`, and can never delay anything downstream.
  const raced = await withScanSourceBudget(
    pollPresenceSourceTarget(env, userId, target.sourceId, {
      fetchImpl: options.fetchImpl,
    }),
    SCAN_SOURCE_BUDGET_MS,
  );
  if (raced.outcome === "timed_out") {
    await tick("timed_out", `budget:${SCAN_SOURCE_BUDGET_MS}ms`);
    return;
  }
  const { pollResult, upsertStats } = raced.value;
  if (!pollResult.ok) {
    await tick("failed", pollResult.errorCode ?? "poll_failed");
    return;
  }
  await tick("done", `items:${upsertStats.inserted + upsertStats.updated}`);
}

/**
 * #3176: the mention leg of the activation fan-out. Runs AFTER the ads
 * capture, inside the same Workflow step, so the #3071 first brief never
 * waits on a mention source: the brief files with whatever finished, and
 * these sources' ticks land on the run row after the run finished — the
 * "late sources append without reload" path. The leg itself never throws:
 * a failing source is ticked `skipped` (plan/connector gates) or `failed`
 * (poll error) and the next source runs.
 */
export async function captureActivationMentionSources(
  env: AppEnv,
  userId: string,
  runId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<void> {
  let targets: ActivationMentionTarget[];
  try {
    targets = await listActivationMentionTargets(env, userId);
  } catch (error) {
    console.log("activation mention enumeration failed (non-blocking)", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  for (const target of targets) {
    try {
      await captureOneActivationMentionSource(env, userId, runId, target, options);
    } catch (error) {
      const { recordScanSourceTick } = await import(
        "~/lib/scan-source-progress.server"
      );
      const { PresenceServiceError } = await import("~/lib/presence-service.server");
      const code =
        error instanceof PresenceServiceError ? error.code : "poll_error";
      await recordScanSourceTick(env, runId, target.sourceId, {
        kind: "mention",
        label: target.label,
        status: "skipped",
        detail: code,
      }).catch(() => {
        // Progress observability never breaks the capture.
      });
    }
  }
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

    // #3176: the fan-out denominator lands before the first source ticks so
    // the page can show the true "scanning N sources" from the start.
    await planActivationScanSources(env, watchlist, plan, params.runId);
    const { runWatchlistManual } = await import("~/lib/monitoring.server");
    await runWatchlistManual(env, watchlist, {
      existingRunId: params.runId,
      orchestrationToken: claim.processingToken,
    });
    // #3176: the mention leg runs after the ads capture — the #3071 first
    // brief gates on the run completing, not on a mention source. Sources
    // finishing after the run wrote their ticks to the (outliving) run row.
    await captureActivationMentionSources(env, watchlist.userId, params.runId);
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
  options?: { reason?: "signup_first_brief" },
) {
  const descriptor = await prepareFirstWatchlistScanRun(env, watchlist, options);
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

/**
 * BET 7 (issue #1276): the same-session first-brief activation path. Queues
 * the existing activation scan with a `signup_first_brief` reason so the
 * Workflow payload and the `first_brief_signup_capture_queued` log line carry
 * the activation origin. The scan itself, the first-brief filing, and the
 * email delivery are unchanged — this only adds the reason and the gate.
 *
 * Returns true when a scan was queued (or already in flight), false when the
 * watchlist was already scanned or missing. The gate (`SIGNUP_FIRST_BRIEF_ENABLED`,
 * default off) is checked by the caller before reaching here so the redirect
 * target stays the caller's decision.
 */
export async function queueFirstWatchlistScanForSignupFirstBrief(
  env: AppEnv,
  ctx: ExecutionContext | undefined,
  watchlist: WatchlistRecord | null | undefined,
) {
  if (!watchlist || watchlist.lastScannedAt) {
    return Promise.resolve(false);
  }

  try {
    const { logAppEvent } = await import("~/lib/log.server");
    logAppEvent(
      "info",
      "first_brief_signup_capture_queued",
      "Activation scan queued for the same-session first brief",
      { details: { watchlistId: watchlist.id, reason: "signup_first_brief" } },
    );
  } catch {
    // Observability must never block the activation dispatch.
  }

  if (env.DB) {
    return prepareFirstWatchlistScanRun(env, watchlist, {
      reason: "signup_first_brief",
    }).then(async (descriptor) => {
      const dispatch = await dispatchFirstWatchlistScanWorkflow(env, descriptor);
      return dispatch.status !== "terminal";
    });
  }

  if (!ctx) {
    return Promise.resolve(false);
  }
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
  const { runWatchlistManual } = await import("~/lib/monitoring.server");
  await runWatchlistManual(env, watchlist);
}
