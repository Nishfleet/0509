import type { AppEnv } from "~/lib/env.server";
import { logAppEvent } from "~/lib/log.server";
import { getWatchlist } from "~/lib/data.server";
import { getScheduledMonitoringPolicy, shouldScheduleScoutOnDate } from "~/lib/plan-entitlements";
import { getUserPlan } from "~/lib/plan.server";
import type { WatchlistRecord, WatchlistRunRecord } from "~/lib/types";

export interface MonitoringWorkflowParams {
  watchlistId: string;
  triggerType: WatchlistRunRecord["triggerType"];
  executionKey: string;
  workflowInstanceId: string;
  proofCaptureRequestKeyPrefix: string;
  queuedAt: string;
  runId: string;
  scheduledSlot: string;
  cron?: string | null;
}

export const MONITORING_WORKFLOW_ID_PREFIX = "monitor-v1-";
export const MONITORING_WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/;
export const MONITORING_WORKFLOW_ID_MAX_LENGTH = 100;

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

export function buildShadowExecutionIdempotencyKey(input: {
  watchlistId: string;
  triggerType: WatchlistRunRecord["triggerType"];
  scheduledTime?: number;
  cron?: string | null;
}) {
  return `shadow:${buildWatchlistExecutionIdempotencyKey(input)}`;
}

function normalizeIdempotencySegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function buildMonitoringWorkflowInstanceId(executionKey: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(executionKey));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64url = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const id = `${MONITORING_WORKFLOW_ID_PREFIX}${base64url.slice(0, 80)}`;
  if (id.length > MONITORING_WORKFLOW_ID_MAX_LENGTH) {
    throw new Error("Derived monitoring workflow instance ID exceeds Cloudflare limit.");
  }
  if (!MONITORING_WORKFLOW_ID_PATTERN.test(id)) {
    throw new Error("Derived monitoring workflow instance ID is invalid for Cloudflare Workflows.");
  }
  return id;
}

export type MonitoringFanoutMode = "inline" | "fanout" | "shadow";

export const MONITORING_CONCURRENCY_SLOT_CAPACITY = 64;
export const MONITORING_WORKFLOW_SCAN_TIMEOUT_MS = 30 * 60 * 1000;
export const MONITORING_LEASE_SAFETY_MARGIN_MS = 15 * 60 * 1000;
export const DEFAULT_MONITORING_FANOUT_MAX_INFLIGHT = 8;
export const DEFAULT_MONITORING_ORCHESTRATION_LEASE_MS =
  MONITORING_WORKFLOW_SCAN_TIMEOUT_MS + MONITORING_LEASE_SAFETY_MARGIN_MS;
export const DEFAULT_MONITORING_CONCURRENCY_SLOT_LEASE_MS = DEFAULT_MONITORING_ORCHESTRATION_LEASE_MS;
export const MONITORING_DISPATCH_BATCH_SIZE = 100;
export const MONITORING_RECONCILIATION_LIMIT = 40;
export const MONITORING_CONCURRENCY_WAIT_MAX_ROUNDS = 240;
export const MONITORING_QUEUE_AGING_INTERVAL_MS = 30 * 60 * 1000;
export const MONITORING_QUEUE_AGING_MAX_BOOST = 2;

interface PendingRunQueueRow {
  id: string;
  watchlist_id: string;
  queue_priority: number;
  queued_at: string;
  started_at: string;
  user_id: string;
  plan: string;
}

export function computeEffectiveQueuePriority(
  queuePriority: number,
  queuedAt: string,
  nowMs = Date.now(),
) {
  const ageMs = Math.max(0, nowMs - Date.parse(queuedAt));
  const boost = Math.min(
    MONITORING_QUEUE_AGING_MAX_BOOST,
    Math.floor(ageMs / MONITORING_QUEUE_AGING_INTERVAL_MS),
  );
  return Math.max(0, queuePriority - boost);
}

export function compareQueuedRuns(
  left: PendingRunQueueRow & { effectivePriority: number },
  right: PendingRunQueueRow & { effectivePriority: number },
) {
  if (left.effectivePriority !== right.effectivePriority) {
    return left.effectivePriority - right.effectivePriority;
  }
  const leftSlot = Date.parse(left.started_at || left.queued_at);
  const rightSlot = Date.parse(right.started_at || right.queued_at);
  if (leftSlot !== rightSlot) return leftSlot - rightSlot;
  const leftQueued = Date.parse(left.queued_at);
  const rightQueued = Date.parse(right.queued_at);
  if (leftQueued !== rightQueued) return leftQueued - rightQueued;
  return left.id.localeCompare(right.id);
}

export async function selectRankedEligibleOrchestratedRuns(env: AppEnv, now = nowIso()) {
  const result = await ensureDb(env)
    .prepare(
      `
        SELECT
          wr.id,
          wr.watchlist_id,
          wr.queue_priority,
          wr.queued_at,
          wr.started_at,
          w.user_id,
          up.plan
        FROM watchlist_run wr
        INNER JOIN watchlist w ON w.id = wr.watchlist_id
        INNER JOIN user_plan up ON up.user_id = w.user_id
        WHERE wr.status = 'pending'
          AND wr.trigger_type = 'scheduled'
          AND (wr.retry_after IS NULL OR wr.retry_after <= ?)
          AND w.is_active = 1
          AND up.plan != 'free'
      `,
    )
    .bind(now)
    .all<PendingRunQueueRow>();

  const nowMs = Date.parse(now);
  return (result.results ?? [])
    .filter((row) => {
      const plan =
        row.plan === "scout" || row.plan === "starter" || row.plan === "agency" ? row.plan : "free";
      if (plan === "scout" && !shouldScheduleScoutOnDate(plan, new Date(nowMs))) {
        return false;
      }
      return true;
    })
    .map((row) => ({
      ...row,
      effectivePriority: computeEffectiveQueuePriority(row.queue_priority, row.queued_at, nowMs),
    }))
    .sort(compareQueuedRuns);
}

export async function selectHeadEligibleOrchestratedRun(env: AppEnv, now = nowIso()) {
  return (await selectRankedEligibleOrchestratedRuns(env, now))[0] ?? null;
}

async function countSlotsHeldByRun(env: AppEnv, runId: string) {
  const row = await one<{ count: number }>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM monitoring_concurrency_slot
      WHERE holder_run_id = ?
    `,
    runId,
  );
  return Number(row?.count ?? 0);
}

export async function isRunEligibleForConcurrencyClaim(
  env: AppEnv,
  runId: string,
  maxSlots = resolveEffectiveMonitoringFanoutMaxInflight(env),
) {
  const ranked = await selectRankedEligibleOrchestratedRuns(env);
  if (ranked.length === 0) {
    return false;
  }
  const position = ranked.findIndex((row) => row.id === runId);
  if (position < 0) {
    return false;
  }
  if (position >= maxSlots) {
    return false;
  }
  if ((await countSlotsHeldByRun(env, runId)) > 0) {
    return false;
  }
  return true;
}

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
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveMonitoringFanoutMode(env: AppEnv): MonitoringFanoutMode {
  const configured = (env.MONITORING_FANOUT_MODE ?? "inline").trim().toLowerCase();
  if (configured === "inline" || configured === "shadow" || configured === "fanout") {
    return configured;
  }
  logAppEvent("warn", "monitoring_fanout_invalid_mode", "Invalid MONITORING_FANOUT_MODE; using inline", {
    details: { configured },
  });
  return "inline";
}

export function isMonitoringWorkflowBindingAvailable(env: AppEnv) {
  const workflow = env.MONITORING_WORKFLOW as WorkflowBinding | undefined;
  return Boolean(workflow && typeof workflow.create === "function");
}

export function resolveEffectiveMonitoringFanoutMaxInflight(env: AppEnv) {
  const capacity = MONITORING_CONCURRENCY_SLOT_CAPACITY;
  const raw = env.MONITORING_FANOUT_MAX_INFLIGHT?.trim();
  if (!raw) {
    return Math.min(DEFAULT_MONITORING_FANOUT_MAX_INFLIGHT, capacity);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isFinite(parsed) || parsed < 1) {
    logAppEvent("warn", "monitoring_fanout_invalid_max_inflight", "Invalid MONITORING_FANOUT_MAX_INFLIGHT; using default", {
      details: { configured: raw, effective: Math.min(DEFAULT_MONITORING_FANOUT_MAX_INFLIGHT, capacity) },
    });
    return Math.min(DEFAULT_MONITORING_FANOUT_MAX_INFLIGHT, capacity);
  }

  if (parsed > capacity) {
    logAppEvent("warn", "monitoring_fanout_max_inflight_clamped", "MONITORING_FANOUT_MAX_INFLIGHT exceeds slot capacity; clamping", {
      details: { configured: parsed, capacity, effective: capacity },
    });
    return capacity;
  }

  return parsed;
}

/** @deprecated Use resolveEffectiveMonitoringFanoutMaxInflight */
export function resolveMonitoringFanoutMaxInflight(env: AppEnv) {
  return resolveEffectiveMonitoringFanoutMaxInflight(env);
}

function resolveEffectiveLeaseMs(
  env: AppEnv,
  envKey: "MONITORING_ORCHESTRATION_LEASE_MS" | "MONITORING_CONCURRENCY_SLOT_LEASE_MS",
  fallback: number,
) {
  const minimumLeaseMs = MONITORING_WORKFLOW_SCAN_TIMEOUT_MS + MONITORING_LEASE_SAFETY_MARGIN_MS;
  const configured = parsePositiveInt(env[envKey], fallback);
  if (configured < minimumLeaseMs) {
    logAppEvent("warn", "monitoring_fanout_lease_clamped", "Configured lease is shorter than scan timeout margin; clamping", {
      details: {
        envKey,
        configured,
        minimumLeaseMs,
        scanTimeoutMs: MONITORING_WORKFLOW_SCAN_TIMEOUT_MS,
        safetyMarginMs: MONITORING_LEASE_SAFETY_MARGIN_MS,
      },
    });
    return minimumLeaseMs;
  }
  return configured;
}

export function resolveMonitoringOrchestrationLeaseMs(env: AppEnv) {
  return resolveEffectiveLeaseMs(
    env,
    "MONITORING_ORCHESTRATION_LEASE_MS",
    DEFAULT_MONITORING_ORCHESTRATION_LEASE_MS,
  );
}

export function resolveMonitoringConcurrencySlotLeaseMs(env: AppEnv) {
  return resolveEffectiveLeaseMs(
    env,
    "MONITORING_CONCURRENCY_SLOT_LEASE_MS",
    DEFAULT_MONITORING_CONCURRENCY_SLOT_LEASE_MS,
  );
}

export function buildMonitoringWorkflowConcurrencyStepName(waitRound: number) {
  return `claim-monitoring-concurrency-${waitRound}`;
}

export function buildMonitoringWorkflowCapacitySleepStepName(waitRound: number) {
  return `wait-monitoring-capacity-${waitRound}`;
}

export function parseMonitoringFanoutAllowlist(env: AppEnv) {
  const raw = env.MONITORING_FANOUT_ALLOWLIST?.trim();
  if (!raw) {
    return null;
  }
  if (raw === "*") {
    return new Set(["*"]);
  }
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function isFanoutEnabledForWorkspace(env: AppEnv, userId: string) {
  const mode = resolveMonitoringFanoutMode(env);
  if (mode === "inline") {
    return false;
  }
  if (mode === "shadow") {
    return true;
  }
  if (env.MONITORING_FANOUT_GLOBAL === "1") {
    return true;
  }
  const allowlist = parseMonitoringFanoutAllowlist(env);
  if (!allowlist || allowlist.size === 0) {
    return false;
  }
  if (allowlist.has("*")) {
    return true;
  }
  return allowlist.has(userId);
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
    queuePriority?: number;
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
        attempt_count,
        queue_priority
      )
      VALUES (?, ?, ?, 'pending', ?, 0, NULL, '{}', ?, NULL, NULL, NULL, ?, ?, ?, ?, 0, ?)
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
    input.queuePriority ?? 2,
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

export async function claimMonitoringConcurrencySlot(
  env: AppEnv,
  input: {
    runId: string;
    leaseMs?: number;
  },
) {
  const eligible = await isRunEligibleForConcurrencyClaim(env, input.runId);
  if (!eligible) {
    return { claimed: false as const, reason: "queue_not_ready" as const };
  }

  const maxSlots = resolveEffectiveMonitoringFanoutMaxInflight(env);
  const leaseMs = input.leaseMs ?? resolveMonitoringConcurrencySlotLeaseMs(env);
  const token = createProcessingToken();
  const timestamp = nowIso();
  const staleBefore = new Date(Date.now() - leaseMs).toISOString();

  const result = await runStatement(
    env,
    `
      UPDATE monitoring_concurrency_slot
      SET holder_run_id = ?1,
          holder_token = ?2,
          leased_at = ?3
      WHERE slot_index = (
        SELECT slot_index
        FROM monitoring_concurrency_slot
        WHERE slot_index < ?4
          AND (
            holder_run_id IS NULL
            OR leased_at < ?5
          )
        ORDER BY CASE WHEN holder_run_id IS NULL THEN 0 ELSE 1 END, leased_at ASC
        LIMIT 1
      )
      AND (
        holder_run_id IS NULL
        OR leased_at < ?5
      )
    `,
    input.runId,
    token,
    timestamp,
    maxSlots,
    staleBefore,
  );

  if (Number(result.meta?.changes ?? 0) === 0) {
    return { claimed: false as const };
  }

  const slot = await one<{ slot_index: number }>(
    env,
    `
      SELECT slot_index
      FROM monitoring_concurrency_slot
      WHERE holder_token = ?
      LIMIT 1
    `,
    token,
  );

  return {
    claimed: true as const,
    token,
    slotIndex: slot?.slot_index ?? null,
  };
}

export async function releaseMonitoringConcurrencySlot(
  env: AppEnv,
  input: {
    token: string;
  },
) {
  const result = await runStatement(
    env,
    `
      UPDATE monitoring_concurrency_slot
      SET holder_run_id = NULL,
          holder_token = NULL,
          leased_at = NULL
      WHERE holder_token = ?
    `,
    input.token,
  );
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function renewMonitoringConcurrencySlot(
  env: AppEnv,
  input: {
    token: string;
  },
) {
  const timestamp = nowIso();
  const result = await runStatement(
    env,
    `
      UPDATE monitoring_concurrency_slot
      SET leased_at = ?
      WHERE holder_token = ?
    `,
    timestamp,
    input.token,
  );
  return Number(result.meta?.changes ?? 0) > 0;
}

export async function countHeldMonitoringConcurrencySlots(env: AppEnv) {
  const maxSlots = resolveEffectiveMonitoringFanoutMaxInflight(env);
  const row = await one<{ count: number }>(
    env,
    `
      SELECT COUNT(*) AS count
      FROM monitoring_concurrency_slot
      WHERE slot_index < ?
        AND holder_run_id IS NOT NULL
    `,
    maxSlots,
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

export async function renewOrchestratedWatchlistRunLease(
  env: AppEnv,
  input: {
    runId: string;
    processingToken: string;
  },
) {
  const timestamp = nowIso();
  const result = await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET processing_started_at = ?,
          updated_at = ?
      WHERE id = ?
        AND processing_token = ?
        AND status = 'running'
    `,
    timestamp,
    timestamp,
    input.runId,
    input.processingToken,
  );
  return Number(result.meta?.changes ?? 0) > 0;
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

export async function cancelOrchestratedRunsForInlineRollback(env: AppEnv) {
  const timestamp = nowIso();
  const result = await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET status = 'skipped',
          finished_at = ?,
          error_code = 'fanout_disabled',
          error_message = 'Scheduled fan-out was disabled before this scan could run.',
          processing_token = NULL,
          processing_started_at = NULL,
          updated_at = ?
      WHERE trigger_type = 'scheduled'
        AND status IN ('pending', 'running')
    `,
    timestamp,
    timestamp,
  );
  return Number(result.meta?.changes ?? 0);
}

export async function hasOrchestratedRunBlockingInlineScan(
  env: AppEnv,
  watchlistId: string,
  executionKey: string,
) {
  const row = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watchlist_run
      WHERE watchlist_id = ?
        AND idempotency_key = ?
        AND trigger_type = 'scheduled'
        AND status IN ('pending', 'running')
      LIMIT 1
    `,
    watchlistId,
    executionKey,
  );
  return Boolean(row?.id);
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
        ORDER BY queue_priority ASC, queued_at ASC, started_at ASC, id ASC
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

type WorkflowBinding = Workflow<MonitoringWorkflowParams> & {
  createBatch?: (
    batch: Array<{ id: string; params: MonitoringWorkflowParams }>,
  ) => Promise<Array<{ id: string }>>;
};

function getMonitoringWorkflowBinding(env: AppEnv) {
  return env.MONITORING_WORKFLOW as WorkflowBinding | undefined;
}

function isRateLimitWorkflowError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /rate.?limit|too many|throttl|429/i.test(error.message);
}

function buildWorkflowParams(input: {
  watchlist: WatchlistRecord;
  runId: string;
  executionKey: string;
  workflowInstanceId: string;
  triggerType: WatchlistRunRecord["triggerType"];
  scheduledTime: number;
  cron?: string | null;
}): MonitoringWorkflowParams {
  const queuedAt = new Date(input.scheduledTime).toISOString();
  return {
    watchlistId: input.watchlist.id,
    triggerType: input.triggerType,
    executionKey: input.executionKey,
    workflowInstanceId: input.workflowInstanceId,
    proofCaptureRequestKeyPrefix: `proof:${input.executionKey}`,
    queuedAt,
    runId: input.runId,
    scheduledSlot: queuedAt,
    cron: input.cron ?? null,
  };
}

export async function dispatchOrchestratedWatchlistJobsBatch(
  env: AppEnv,
  input: {
    jobs: Array<{
      watchlist: WatchlistRecord;
      runId: string;
      executionKey: string;
      workflowInstanceId: string;
      triggerType: WatchlistRunRecord["triggerType"];
      scheduledTime: number;
      cron?: string | null;
    }>;
    shadowOnly?: boolean;
  },
) {
  if (input.shadowOnly || input.jobs.length === 0) {
    return {
      dispatched: 0,
      duplicates: 0,
      failures: [] as Array<{ runId: string; error: string }>,
    };
  }

  const workflow = getMonitoringWorkflowBinding(env);
  if (!workflow || typeof workflow.create !== "function") {
    logAppEvent("error", "monitoring_fanout_workflow_binding_missing", "MONITORING_WORKFLOW binding is unavailable", {
      details: { jobCount: input.jobs.length },
    });
    return {
      dispatched: 0,
      duplicates: 0,
      failures: input.jobs.map((job) => ({
        runId: job.runId,
        error: "MONITORING_WORKFLOW binding is not configured.",
      })),
      bindingMissing: true as const,
    };
  }

  if (typeof workflow.createBatch !== "function") {
    logAppEvent("error", "monitoring_fanout_createbatch_missing", "MONITORING_WORKFLOW.createBatch is unavailable", {
      details: { jobCount: input.jobs.length },
    });
    return {
      dispatched: 0,
      duplicates: 0,
      failures: input.jobs.map((job) => ({
        runId: job.runId,
        error: "MONITORING_WORKFLOW.createBatch is not available.",
      })),
      createBatchMissing: true as const,
    };
  }

  const batch = input.jobs.map((job) => ({
    id: job.workflowInstanceId,
    params: buildWorkflowParams(job),
  }));

  let createdIds: Set<string>;
  try {
    const instances = await workflow.createBatch(batch);
    createdIds = new Set(instances.map((instance) => instance.id));
  } catch (error) {
    if (isRateLimitWorkflowError(error)) {
      return {
        dispatched: 0,
        duplicates: 0,
        failures: input.jobs.map((job) => ({
          runId: job.runId,
          error: error instanceof Error ? error.message : "Workflow rate limited.",
        })),
        rateLimited: true as const,
      };
    }
    throw error;
  }

  let dispatched = 0;
  let duplicates = 0;
  const failures: Array<{ runId: string; error: string }> = [];

  for (const job of input.jobs) {
    if (createdIds.has(job.workflowInstanceId)) {
      await markOrchestratedRunDispatched(env, {
        runId: job.runId,
        workflowInstanceId: job.workflowInstanceId,
      });
      dispatched += 1;
      continue;
    }

    duplicates += 1;
    await markOrchestratedRunDispatched(env, {
      runId: job.runId,
      workflowInstanceId: job.workflowInstanceId,
    });
  }

  return { dispatched, duplicates, failures };
}

export async function dispatchOrchestratedWatchlistJob(
  env: AppEnv,
  input: {
    watchlist: WatchlistRecord;
    runId: string;
    executionKey: string;
    workflowInstanceId: string;
    triggerType: WatchlistRunRecord["triggerType"];
    scheduledTime: number;
    cron?: string | null;
    shadowOnly?: boolean;
  },
) {
  const result = await dispatchOrchestratedWatchlistJobsBatch(env, {
    jobs: [input],
    shadowOnly: input.shadowOnly,
  });
  if (result.failures.length > 0) {
    throw new Error(result.failures[0]!.error);
  }
  if (input.shadowOnly) {
    return { status: "shadow" as const };
  }
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
    const dispatchJobs: Array<{
      watchlist: WatchlistRecord;
      runId: string;
      executionKey: string;
      workflowInstanceId: string;
      triggerType: WatchlistRunRecord["triggerType"];
      scheduledTime: number;
      cron?: string | null;
    }> = [];

    for (const watchlist of batch) {
      const eligibility = await isWatchlistEligibleForScheduledScan(env, watchlist);
      if (!eligibility.eligible) {
        continue;
      }

      if (!isFanoutEnabledForWorkspace(env, watchlist.userId)) {
        continue;
      }

      const executionKey = buildWatchlistExecutionIdempotencyKey({
        watchlistId: watchlist.id,
        triggerType: "scheduled",
        scheduledTime: input.scheduledTime,
        cron: input.cron,
      });

      if (shadowOnly) {
        shadowOnlyCount += 1;
        continue;
      }

      const ensured = await ensureOrchestratedWatchlistRun(env, {
        watchlistId: watchlist.id,
        triggerType: "scheduled",
        executionKey,
        pageBudget,
        scheduledTime: input.scheduledTime,
        queuePriority: getScheduledMonitoringPolicy(
          await getUserPlan(env, watchlist.userId),
        ).monitoringQueuePriority,
      });
      if (!ensured.created) {
        duplicates += 1;
        continue;
      }
      queued += 1;

      const workflowInstanceId = await buildMonitoringWorkflowInstanceId(executionKey);
      dispatchJobs.push({
        watchlist,
        runId: ensured.runId,
        executionKey,
        workflowInstanceId,
        triggerType: "scheduled",
        scheduledTime: input.scheduledTime,
        cron: input.cron,
      });
    }

    if (dispatchJobs.length === 0) {
      continue;
    }

    try {
      const dispatch = await dispatchOrchestratedWatchlistJobsBatch(env, {
        jobs: dispatchJobs,
        shadowOnly: false,
      });
      duplicates += dispatch.duplicates;
      for (const failure of dispatch.failures) {
        dispatchFailures += 1;
        const errorCode = dispatch.bindingMissing
          ? "workflow_binding_missing"
          : dispatch.createBatchMissing
            ? "dispatch_createbatch_missing"
            : dispatch.rateLimited
              ? "dispatch_rate_limited"
              : "dispatch_failed";
        await markOrchestratedDispatchFailure(env, {
          runId: failure.runId,
          errorCode,
          errorMessage: failure.error,
          retryAfterIso: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
        logAppEvent("error", "monitoring_fanout_dispatch_failed", "Workflow dispatch failed", {
          details: {
            runId: failure.runId,
            error: failure.error,
          },
        });
      }
    } catch (error) {
      for (const job of dispatchJobs) {
        dispatchFailures += 1;
        await markOrchestratedDispatchFailure(env, {
          runId: job.runId,
          errorCode: isRateLimitWorkflowError(error) ? "dispatch_rate_limited" : "dispatch_failed",
          errorMessage: error instanceof Error ? error.message : "Dispatch failed.",
          retryAfterIso: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
      }
      logAppEvent("error", "monitoring_fanout_dispatch_batch_failed", "Workflow batch dispatch failed", {
        details: {
          batchSize: dispatchJobs.length,
          error: error instanceof Error ? error.message : String(error),
        },
      });
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
    const cancelled = await cancelOrchestratedRunsForInlineRollback(env);
    return { recovered: 0, cancelled, redispatched: 0 };
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

    if (!isFanoutEnabledForWorkspace(env, watchlist.user_id)) {
      await markOrchestratedRunCancelled(env, {
        runId: row.id,
        reason: "workspace_not_allowlisted",
        message: "Scheduled fan-out is not enabled for this workspace.",
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

    const workflowInstanceId =
      row.workflow_instance_id ??
      (await buildMonitoringWorkflowInstanceId(row.idempotency_key));

    try {
      await dispatchOrchestratedWatchlistJob(env, {
        watchlist: watchlistRecord,
        runId: row.id,
        executionKey: row.idempotency_key,
        workflowInstanceId,
        triggerType: "scheduled",
        scheduledTime: input.scheduledTime ?? Date.now(),
        cron: input.cron,
        shadowOnly,
      });
      redispatched += 1;
    } catch (error) {
      await markOrchestratedDispatchFailure(env, {
        runId: row.id,
        errorCode: isRateLimitWorkflowError(error) ? "dispatch_rate_limited" : "reconcile_dispatch_failed",
        errorMessage: error instanceof Error ? error.message : "Re-dispatch failed.",
      });
    }
  }

  return { recovered, cancelled, redispatched };
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
      if (
        row.error_code === "dispatch_failed" ||
        row.error_code === "reconcile_dispatch_failed" ||
        row.error_code === "dispatch_rate_limited" ||
        row.error_code === "workflow_binding_missing" ||
        row.error_code === "dispatch_createbatch_missing"
      ) {
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
