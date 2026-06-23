import type { AppEnv } from "~/lib/env.server";
import { logAppEvent } from "~/lib/log.server";
import { getWatchlist } from "~/lib/data.server";
import { getUserPlan } from "~/lib/plan.server";
import type { WatchlistRecord, WatchlistRunRecord } from "~/lib/types";

export interface MonitoringWorkflowParams {
  watchlistId: string;
  triggerType: WatchlistRunRecord["triggerType"];
  executionKey: string;
  proofCaptureRequestKeyPrefix: string;
  queuedAt: string;
  runId: string;
  scheduledSlot: string;
  cron?: string | null;
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

function normalizeIdempotencySegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export type MonitoringFanoutMode = "inline" | "fanout" | "shadow";

export const DEFAULT_MONITORING_FANOUT_MAX_INFLIGHT = 8;
export const DEFAULT_MONITORING_ORCHESTRATION_LEASE_MS = 15 * 60 * 1000;
export const MONITORING_DISPATCH_BATCH_SIZE = 25;
export const MONITORING_RECONCILIATION_LIMIT = 40;

export interface MonitoringFanoutScheduleResult {
  eligible: number;
  queued: number;
  duplicates: number;
  dispatchFailures: number;
  shadowOnly: number;
  inlineFallback: boolean;
}

export interface MonitoringOrchestrationMetrics {
  eligible: number;
  queued: number;
  dispatched: number;
  running: number;
  succeeded: number;
  retrying: number;
  failed: number;
  delayed: number;
  duplicatesPrevented: number;
  oldestQueuedAgeMs: number | null;
}

function ensureDb(env: AppEnv) {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is not configured.");
  }
  return env.DB;
}

function nowIso() {
  return new Date().toISOString();
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveMonitoringFanoutMode(env: AppEnv): MonitoringFanoutMode {
  const configured = (env.MONITORING_FANOUT_MODE ?? "fanout").trim().toLowerCase();
  if (configured === "inline" || configured === "shadow") {
    return configured;
  }
  if (!env.MONITORING_WORKFLOW) {
    return "inline";
  }
  return "fanout";
}

export function resolveMonitoringFanoutMaxInflight(env: AppEnv) {
  return parsePositiveInt(env.MONITORING_FANOUT_MAX_INFLIGHT, DEFAULT_MONITORING_FANOUT_MAX_INFLIGHT);
}

export function resolveMonitoringOrchestrationLeaseMs(env: AppEnv) {
  return parsePositiveInt(
    env.MONITORING_ORCHESTRATION_LEASE_MS,
    DEFAULT_MONITORING_ORCHESTRATION_LEASE_MS,
  );
}

function createId() {
  return crypto.randomUUID();
}

function createProcessingToken() {
  return crypto.randomUUID();
}

interface OrchestratedRunRow {
  id: string;
  watchlist_id: string;
  status: WatchlistRunRecord["status"];
  idempotency_key: string | null;
  workflow_instance_id: string | null;
  processing_token: string | null;
  attempt_count: number;
}

async function one<T>(env: AppEnv, sql: string, ...bindings: unknown[]) {
  return ensureDb(env)
    .prepare(sql)
    .bind(...bindings)
    .first<T>();
}

async function runStatement(env: AppEnv, sql: string, ...bindings: unknown[]) {
  return ensureDb(env).prepare(sql).bind(...bindings).run();
}

export async function ensureOrchestratedWatchlistRun(
  env: AppEnv,
  input: {
    watchlistId: string;
    triggerType: WatchlistRunRecord["triggerType"];
    executionKey: string;
    pageBudget: number;
    scheduledTime: number;
  },
) {
  const timestamp = nowIso();
  const id = createId();
  const result = await runStatement(
    env,
    `
      INSERT OR IGNORE INTO watchlist_run (
        id,
        watchlist_id,
        trigger_type,
        status,
        page_budget,
        pages_scanned,
        baseline_from_run_id,
        summary_json,
        started_at,
        finished_at,
        error_code,
        error_message,
        created_at,
        updated_at,
        idempotency_key,
        queued_at,
        attempt_count
      )
      VALUES (?, ?, ?, 'pending', ?, 0, NULL, '{}', ?, NULL, NULL, NULL, ?, ?, ?, ?, 0)
    `,
    id,
    input.watchlistId,
    input.triggerType,
    input.pageBudget,
    timestamp,
    timestamp,
    timestamp,
    input.executionKey,
    timestamp,
  );

  if (Number(result.meta?.changes ?? 0) > 0) {
    return { runId: id, created: true as const };
  }

  const existing = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watchlist_run
      WHERE idempotency_key = ?
      LIMIT 1
    `,
    input.executionKey,
  );
  if (!existing?.id) {
    throw new Error("Failed to create or locate orchestrated watchlist run.");
  }
  return { runId: existing.id, created: false as const };
}

export async function markOrchestratedRunDispatched(
  env: AppEnv,
  input: {
    runId: string;
    workflowInstanceId: string;
  },
) {
  const timestamp = nowIso();
  await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET workflow_instance_id = ?,
          queued_at = COALESCE(queued_at, ?),
          updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'running')
    `,
    input.workflowInstanceId,
    timestamp,
    timestamp,
    input.runId,
  );
}

export async function markOrchestratedDispatchFailure(
  env: AppEnv,
  input: {
    runId: string;
    errorCode: string;
    errorMessage: string;
    retryAfterIso?: string;
  },
) {
  const timestamp = nowIso();
  await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET status = 'pending',
          error_code = ?,
          error_message = ?,
          retry_after = ?,
          attempt_count = attempt_count + 1,
          updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'running')
    `,
    input.errorCode,
    input.errorMessage,
    input.retryAfterIso ?? null,
    timestamp,
    input.runId,
  );
}

export async function countActiveOrchestratedRuns(env: AppEnv) {
  const row = await one<{ count: number }>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM watchlist_run
      WHERE status = 'running'
        AND trigger_type = 'scheduled'
    `,
  );
  return Number(row?.count ?? 0);
}

export async function claimOrchestratedWatchlistRun(
  env: AppEnv,
  input: {
    runId: string;
    leaseMs: number;
  },
) {
  const token = createProcessingToken();
  const timestamp = nowIso();
  const leaseDays = input.leaseMs / (24 * 60 * 60 * 1000);
  const result = await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET status = 'running',
          processing_token = ?,
          processing_started_at = ?,
          attempt_count = attempt_count + 1,
          error_code = NULL,
          error_message = NULL,
          retry_after = NULL,
          updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'running')
        AND (
          status = 'pending'
          OR processing_started_at IS NULL
          OR julianday(?) > julianday(processing_started_at) + ?
        )
    `,
    token,
    timestamp,
    timestamp,
    input.runId,
    timestamp,
    leaseDays,
  );

  if (Number(result.meta?.changes ?? 0) === 0) {
    return { claimed: false as const };
  }
  return { claimed: true as const, processingToken: token };
}

export async function finishOrchestratedWatchlistRun(
  env: AppEnv,
  input: {
    runId: string;
    processingToken: string;
    status: WatchlistRunRecord["status"];
    pagesScanned: number;
    summary: Record<string, unknown>;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
) {
  const timestamp = nowIso();
  const result = await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET status = ?,
          pages_scanned = ?,
          summary_json = ?,
          finished_at = ?,
          error_code = ?,
          error_message = ?,
          processing_token = NULL,
          processing_started_at = NULL,
          updated_at = ?
      WHERE id = ?
        AND processing_token = ?
    `,
    input.status,
    input.pagesScanned,
    JSON.stringify(input.summary),
    timestamp,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    timestamp,
    input.runId,
    input.processingToken,
  );
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function markOrchestratedRunCancelled(
  env: AppEnv,
  input: {
    runId: string;
    reason: string;
    message: string;
  },
) {
  const timestamp = nowIso();
  await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET status = 'skipped',
          finished_at = ?,
          error_code = ?,
          error_message = ?,
          processing_token = NULL,
          processing_started_at = NULL,
          updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'running')
    `,
    timestamp,
    input.reason,
    input.message,
    timestamp,
    input.runId,
  );
}

export async function listOrchestratedRunsForReconciliation(
  env: AppEnv,
  input: {
    leaseMs: number;
    limit?: number;
  },
) {
  const limit = input.limit ?? MONITORING_RECONCILIATION_LIMIT;
  const staleBefore = new Date(Date.now() - input.leaseMs).toISOString();
  const result = await ensureDb(env)
    .prepare(
      `
        SELECT
          id,
          watchlist_id,
          status,
          idempotency_key,
          workflow_instance_id,
          processing_token,
          attempt_count
        FROM watchlist_run
        WHERE trigger_type = 'scheduled'
          AND (
            (status = 'pending' AND (retry_after IS NULL OR retry_after <= ?))
            OR (status = 'running' AND processing_started_at IS NOT NULL AND processing_started_at < ?)
          )
        ORDER BY queued_at ASC, started_at ASC
        LIMIT ?
      `,
    )
    .bind(nowIso(), staleBefore, limit)
    .all<OrchestratedRunRow>();
  return result.results ?? [];
}

export async function isWatchlistEligibleForScheduledScan(
  env: AppEnv,
  watchlist: WatchlistRecord,
) {
  if (!watchlist.isActive) {
    return { eligible: false as const, reason: "watchlist_inactive" };
  }
  const plan = await getUserPlan(env, watchlist.userId);
  if (plan === "free") {
    return { eligible: false as const, reason: "plan_ineligible" };
  }
  return { eligible: true as const, plan };
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

export async function dispatchOrchestratedWatchlistJob(
  env: AppEnv,
  input: {
    watchlist: WatchlistRecord;
    runId: string;
    executionKey: string;
    triggerType: WatchlistRunRecord["triggerType"];
    scheduledTime: number;
    cron?: string | null;
    shadowOnly?: boolean;
  },
) {
  if (input.shadowOnly) {
    return { status: "shadow" as const };
  }

  const workflow = getMonitoringWorkflowBinding(env);
  if (!workflow) {
    throw new Error("MONITORING_WORKFLOW binding is not configured.");
  }

  const queuedAt = new Date(input.scheduledTime).toISOString();
  await workflow.create({
    id: input.executionKey,
    params: {
      watchlistId: input.watchlist.id,
      triggerType: input.triggerType,
      executionKey: input.executionKey,
      proofCaptureRequestKeyPrefix: `proof:${input.executionKey}`,
      queuedAt,
      runId: input.runId,
      scheduledSlot: queuedAt,
      cron: input.cron ?? null,
    },
  });
  await markOrchestratedRunDispatched(env, {
    runId: input.runId,
    workflowInstanceId: input.executionKey,
  });
  return { status: "dispatched" as const };
}

export async function scheduleWatchlistFanout(
  env: AppEnv,
  input: {
    watchlists: WatchlistRecord[];
    scheduledTime: number;
    cron?: string | null;
    pageBudget?: number;
    mode: MonitoringFanoutMode;
  },
): Promise<MonitoringFanoutScheduleResult> {
  const pageBudget = input.pageBudget ?? 2;
  const shadowOnly = input.mode === "shadow";
  let queued = 0;
  let duplicates = 0;
  let dispatchFailures = 0;
  let shadowOnlyCount = 0;

  for (let offset = 0; offset < input.watchlists.length; offset += MONITORING_DISPATCH_BATCH_SIZE) {
    const batch = input.watchlists.slice(offset, offset + MONITORING_DISPATCH_BATCH_SIZE);
    for (const watchlist of batch) {
      const eligibility = await isWatchlistEligibleForScheduledScan(env, watchlist);
      if (!eligibility.eligible) {
        continue;
      }

      const executionKey = buildWatchlistExecutionIdempotencyKey({
        watchlistId: watchlist.id,
        triggerType: "scheduled",
        scheduledTime: input.scheduledTime,
        cron: input.cron,
      });

      const ensured = await ensureOrchestratedWatchlistRun(env, {
        watchlistId: watchlist.id,
        triggerType: "scheduled",
        executionKey,
        pageBudget,
        scheduledTime: input.scheduledTime,
      });
      if (!ensured.created) {
        duplicates += 1;
        continue;
      }
      queued += 1;

      try {
        const dispatch = await dispatchOrchestratedWatchlistJob(env, {
          watchlist,
          runId: ensured.runId,
          executionKey,
          triggerType: "scheduled",
          scheduledTime: input.scheduledTime,
          cron: input.cron,
          shadowOnly,
        });
        if (dispatch.status === "shadow") {
          shadowOnlyCount += 1;
        }
      } catch (error) {
        if (isDuplicateWorkflowCreateError(error)) {
          duplicates += 1;
          await markOrchestratedRunDispatched(env, {
            runId: ensured.runId,
            workflowInstanceId: executionKey,
          });
          continue;
        }
        dispatchFailures += 1;
        await markOrchestratedDispatchFailure(env, {
          runId: ensured.runId,
          errorCode: "dispatch_failed",
          errorMessage: error instanceof Error ? error.message : "Dispatch failed.",
          retryAfterIso: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
        logAppEvent("error", "monitoring_fanout_dispatch_failed", "Workflow dispatch failed", {
          watchlistId: watchlist.id,
          details: {
            runId: ensured.runId,
            executionKey,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  return {
    eligible: input.watchlists.length,
    queued,
    duplicates,
    dispatchFailures,
    shadowOnly: shadowOnlyCount,
    inlineFallback: false,
  };
}

export async function reconcileOrchestratedWatchlistRuns(
  env: AppEnv,
  input: {
    scheduledTime?: number;
    cron?: string | null;
    mode: MonitoringFanoutMode;
    leaseMs?: number;
  },
) {
  if (input.mode === "inline") {
    return { recovered: 0, cancelled: 0, redispatched: 0 };
  }

  const leaseMs = input.leaseMs ?? resolveMonitoringOrchestrationLeaseMs(env);
  const shadowOnly = input.mode === "shadow";
  const staleRuns = await listOrchestratedRunsForReconciliation(env, { leaseMs });
  let recovered = 0;
  let cancelled = 0;
  let redispatched = 0;

  for (const row of staleRuns) {
    const watchlist = await one<{ id: string; user_id: string; is_active: number }>(
      env,
      "SELECT id, user_id, is_active FROM watchlist WHERE id = ?",
      row.watchlist_id,
    );
    if (!watchlist || watchlist.is_active !== 1) {
      await markOrchestratedRunCancelled(env, {
        runId: row.id,
        reason: "watchlist_unavailable",
        message: "This competitor is no longer being tracked.",
      });
      cancelled += 1;
      continue;
    }

    const plan = await getUserPlan(env, watchlist.user_id);
    if (plan === "free") {
      await markOrchestratedRunCancelled(env, {
        runId: row.id,
        reason: "plan_ineligible",
        message: "Scheduled scans paused for this workspace.",
      });
      cancelled += 1;
      continue;
    }

    if (row.status === "running") {
      recovered += 1;
    }

    if (!row.idempotency_key || shadowOnly) {
      continue;
    }

    const watchlistRecord = await getWatchlist(env, row.watchlist_id);
    if (!watchlistRecord) {
      continue;
    }

    try {
      await dispatchOrchestratedWatchlistJob(env, {
        watchlist: watchlistRecord,
        runId: row.id,
        executionKey: row.idempotency_key,
        triggerType: "scheduled",
        scheduledTime: input.scheduledTime ?? Date.now(),
        cron: input.cron,
        shadowOnly,
      });
      redispatched += 1;
    } catch (error) {
      if (!isDuplicateWorkflowCreateError(error)) {
        await markOrchestratedDispatchFailure(env, {
          runId: row.id,
          errorCode: "reconcile_dispatch_failed",
          errorMessage: error instanceof Error ? error.message : "Re-dispatch failed.",
        });
      }
    }
  }

  return { recovered, cancelled, redispatched };
}

export async function acquireMonitoringConcurrencySlot(env: AppEnv) {
  const maxInflight = resolveMonitoringFanoutMaxInflight(env);
  const active = await countActiveOrchestratedRuns(env);
  return active < maxInflight;
}

export async function collectMonitoringOrchestrationMetrics(
  env: AppEnv,
): Promise<MonitoringOrchestrationMetrics> {
  const rows = await ensureDb(env)
    .prepare(
      `
        SELECT status, error_code, queued_at
        FROM watchlist_run
        WHERE trigger_type = 'scheduled'
          AND started_at >= datetime('now', '-2 days')
      `,
    )
    .all<{ status: string; error_code: string | null; queued_at: string | null }>();
  const results = rows.results ?? [];
  const metrics: MonitoringOrchestrationMetrics = {
    eligible: 0,
    queued: 0,
    dispatched: 0,
    running: 0,
    succeeded: 0,
    retrying: 0,
    failed: 0,
    delayed: 0,
    duplicatesPrevented: 0,
    oldestQueuedAgeMs: null,
  };

  let oldestQueuedAt: number | null = null;
  for (const row of results) {
    if (row.status === "pending") {
      metrics.queued += 1;
      if (row.queued_at) {
        const queuedAt = Date.parse(row.queued_at);
        if (Number.isFinite(queuedAt)) {
          oldestQueuedAt =
            oldestQueuedAt === null ? queuedAt : Math.min(oldestQueuedAt, queuedAt);
        }
      }
      if (row.error_code === "dispatch_failed" || row.error_code === "reconcile_dispatch_failed") {
        metrics.retrying += 1;
      }
    } else if (row.status === "running") {
      metrics.running += 1;
    } else if (row.status === "succeeded") {
      metrics.succeeded += 1;
    } else if (row.status === "failed") {
      metrics.failed += 1;
    } else if (row.status === "skipped") {
      metrics.delayed += 1;
    }
  }
  metrics.dispatched = metrics.queued + metrics.running + metrics.succeeded + metrics.failed;
  metrics.oldestQueuedAgeMs =
    oldestQueuedAt === null ? null : Math.max(0, Date.now() - oldestQueuedAt);
  return metrics;
}
