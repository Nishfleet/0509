import type { AppEnv } from "~/lib/env.server";
import { ensureDb, execute as runStatement, queryOne as one } from "~/lib/data/d1.server";
import { billingCanaryMutationGuardSql } from "~/lib/data/billing-canary-lock.server";
import { logAppEvent } from "~/lib/log.server";
import { getWatchlist } from "~/lib/data.server";
import { getScheduledMonitoringPolicy } from "~/lib/plan-entitlements";
import type { WatchlistRecord, WatchlistRunRecord } from "~/lib/types";
import type {
  FirstWatchlistScanRunDescriptor,
  FirstWatchlistScanWorkflowParams,
} from "~/lib/monitoring.server";

export interface ScheduledMonitoringWorkflowParams {
  kind: "scheduled_scan";
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

export type MonitoringWorkflowParams =
  | ScheduledMonitoringWorkflowParams
  | FirstWatchlistScanWorkflowParams;

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
export const DEFAULT_MONITORING_ORCHESTRATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_MONITORING_FANOUT_MAX_INFLIGHT = 8;
export const DEFAULT_MONITORING_ORCHESTRATION_LEASE_MS =
  MONITORING_WORKFLOW_SCAN_TIMEOUT_MS + MONITORING_LEASE_SAFETY_MARGIN_MS;
export const DEFAULT_MONITORING_CONCURRENCY_SLOT_LEASE_MS = DEFAULT_MONITORING_ORCHESTRATION_LEASE_MS;
export const MONITORING_DISPATCH_BATCH_SIZE = 100;
export const MONITORING_RECONCILIATION_LIMIT = 40;
export const MONITORING_CONCURRENCY_WAIT_MAX_ROUNDS = 240;
export const MONITORING_QUEUE_AGING_INTERVAL_MS = 30 * 60 * 1000;
export const MONITORING_QUEUE_AGING_MAX_BOOST = 2;

export type ScheduledBrowserAccessMode = "off" | "billing" | "allowlist" | "all";

const ACTIVE_SCHEDULED_BROWSER_BILLING_STATUSES = new Set([
  "active",
  "subscription.active",
  "subscription.renewed",
  "subscription.plan_changed",
  "plan_change_pending",
  "plan_change_scheduled",
]);
const SUCCESSFUL_SUBSCRIPTION_PAYMENT_STATUSES = new Set(["succeeded", "payment.succeeded"]);
const RETRYING_SUBSCRIPTION_BILLING_STATUSES = new Set([
  "payment.failed",
  "subscription.failed",
  "subscription.on_hold",
]);
const CANCELLATION_SCHEDULED_STATUS = "cancellation_scheduled";

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
        LEFT JOIN user_plan up ON up.user_id = w.user_id
        WHERE wr.status = 'pending'
          AND wr.trigger_type = 'scheduled'
          AND wr.idempotency_key IS NOT NULL
          AND (wr.retry_after IS NULL OR wr.retry_after <= ?)
          AND w.is_active = 1
      `,
    )
    .bind(now)
    .all<PendingRunQueueRow>();

  const nowMs = Date.parse(now);
  const eligibleRows: PendingRunQueueRow[] = [];
  for (const row of result.results ?? []) {
    const access = await evaluateScheduledBrowserAccess(env, row.user_id);
    if (access.eligible) {
      eligibleRows.push(row);
    }
  }

  return eligibleRows
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

function nowIso() {
  return new Date().toISOString();
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseIdSet(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function resolveScheduledBrowserAccessMode(env: AppEnv): ScheduledBrowserAccessMode {
  const configured = (env.MONITORING_SCHEDULED_BROWSER_MODE ?? "billing").trim().toLowerCase();
  if (configured === "off" || configured === "false" || configured === "0" || configured === "disabled") {
    return "off";
  }
  if (configured === "billing" || configured === "paid" || configured === "subscription") {
    return "billing";
  }
  if (configured === "allowlist" || configured === "internal") {
    return "allowlist";
  }
  if (configured === "all" || configured === "true" || configured === "1" || configured === "enabled") {
    return "all";
  }

  logAppEvent("warn", "scheduled_browser_invalid_mode", "Invalid MONITORING_SCHEDULED_BROWSER_MODE; using billing", {
    details: { configured },
  });
  return "billing";
}

export function isScheduledBrowserAllowlisted(env: AppEnv, userId: string) {
  const allowlist = parseIdSet(env.MONITORING_SCHEDULED_BROWSER_ALLOWLIST);
  const internalWorkspaceUserId = env.MONITORING_FANOUT_INTERNAL_WORKSPACE_USER_ID?.trim();
  if (internalWorkspaceUserId) {
    allowlist.add(internalWorkspaceUserId);
  }
  return allowlist.has("*") || allowlist.has(userId);
}

function hasActiveScheduledBrowserSubscription(input: {
  dodoStatus: string | null;
  dodoSubscriptionId: string | null;
  dodoNextBillingAt: string | null;
  billingInterval: "monthly" | "annual" | null;
}) {
  if (!input.dodoSubscriptionId) {
    return false;
  }

  const status = input.dodoStatus?.trim().toLowerCase() ?? "";
  if (ACTIVE_SCHEDULED_BROWSER_BILLING_STATUSES.has(status)) {
    return true;
  }

  if (RETRYING_SUBSCRIPTION_BILLING_STATUSES.has(status)) {
    return true;
  }

  if (SUCCESSFUL_SUBSCRIPTION_PAYMENT_STATUSES.has(status) && input.billingInterval) {
    return true;
  }

  if (status === CANCELLATION_SCHEDULED_STATUS) {
    if (!input.dodoNextBillingAt) {
      return true;
    }
    const nextBillingAt = Date.parse(input.dodoNextBillingAt);
    return !Number.isFinite(nextBillingAt) || nextBillingAt > Date.now();
  }

  return false;
}

export async function evaluateScheduledBrowserAccess(env: AppEnv, userId: string) {
  const mode = resolveScheduledBrowserAccessMode(env);
  const allowlisted = isScheduledBrowserAllowlisted(env, userId);

  if (mode === "off") {
    return { eligible: false as const, reason: "scheduled_browser_disabled", mode, allowlisted };
  }

  const { getUserPlanBillingInfo } = await import("~/lib/data.server");
  const billing = await getUserPlanBillingInfo(env, userId);
  const hasActiveSubscription = hasActiveScheduledBrowserSubscription(billing);

  if (mode === "allowlist") {
    return allowlisted
      ? { eligible: true as const, reason: "allowlisted", mode, allowlisted, plan: billing.plan }
      : { eligible: false as const, reason: "workspace_not_allowlisted", mode, allowlisted, plan: billing.plan };
  }

  if (allowlisted) {
    return { eligible: true as const, reason: "allowlisted", mode, allowlisted, plan: billing.plan };
  }

  if (billing.plan === "free") {
    // Free Weekly Competitor Watch: free is entitlement-eligible for scheduled
    // scans when its cadence is not "none". Time gating (one Monday tick per
    // week) happens where watchlists are listed and filtered for a run —
    // shouldSchedulePlanInRegularScan — not here.
    return getScheduledMonitoringPolicy("free").scheduledScanCadence === "none"
      ? { eligible: false as const, reason: "plan_ineligible", mode, allowlisted, plan: billing.plan }
      : { eligible: true as const, reason: "free_weekly", mode, allowlisted, plan: billing.plan };
  }

  if (mode === "all") {
    return { eligible: true as const, reason: "all_enabled", mode, allowlisted, plan: billing.plan };
  }

  if (hasActiveSubscription) {
    return { eligible: true as const, reason: "active_subscription", mode, allowlisted, plan: billing.plan };
  }

  return {
    eligible: false as const,
    reason: "subscription_required",
    mode,
    allowlisted,
    plan: billing.plan,
    dodoStatus: billing.dodoStatus,
    hasSubscriptionId: Boolean(billing.dodoSubscriptionId),
  };
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

export function resolveMonitoringOrchestrationMaxAgeMs(env: AppEnv) {
  return parsePositiveInt(
    env.MONITORING_ORCHESTRATION_MAX_AGE_MS,
    DEFAULT_MONITORING_ORCHESTRATION_MAX_AGE_MS,
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
  queued_at: string | null;
  started_at: string | null;
  created_at: string | null;
}

interface FirstScanReconciliationRow extends OrchestratedRunRow {
  error_code: string | null;
  retry_after: string | null;
}

const RETRYABLE_FIRST_SCAN_ERROR_CODES = new Set([
  "browser_launch_failed",
  "concurrency_limited",
  "dispatch_rate_limited",
  "first_scan_dispatch_failed",
  "first_scan_setup_failed",
  "rate_limited",
  "retryable_scan_failure",
  "workflow_binding_missing",
]);
export const FIRST_SCAN_MAX_ATTEMPTS = 4;

export async function ensureOrchestratedWatchlistRun(
  env: AppEnv,
  input: {
    watchlistId: string;
    triggerType: WatchlistRunRecord["triggerType"];
    executionKey: string;
    pageBudget: number;
    scheduledTime: number;
    queuePriority?: number;
    allowConcurrentActiveRun?: boolean;
    allowActiveRunFallback?: boolean;
  },
) {
  const scheduledSlot = new Date(input.scheduledTime).toISOString();
  const insertPendingRun = async () => {
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
        SELECT ?, ?, ?, 'pending', ?, 0, NULL, '{}', ?, NULL, NULL, NULL, ?, ?, ?, ?, 0, ?
        WHERE (
          ? = 1
          OR NOT EXISTS (
          SELECT 1
          FROM watchlist_run
          WHERE watchlist_id = ?
            AND trigger_type = ?
            AND idempotency_key IS NOT NULL
            AND status IN ('pending', 'running')
          LIMIT 1
          )
        )
      `,
      id,
      input.watchlistId,
      input.triggerType,
      input.pageBudget,
      scheduledSlot,
      timestamp,
      timestamp,
      input.executionKey,
      timestamp,
      input.queuePriority ?? 2,
      input.allowConcurrentActiveRun ? 1 : 0,
      input.watchlistId,
      input.triggerType,
    );
    return Number(result.meta?.changes ?? 0) > 0 ? id : null;
  };

  const findExistingByExecutionKey = () => one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watchlist_run
      WHERE idempotency_key = ?
      LIMIT 1
    `,
    input.executionKey,
  );

  const findActiveRun = () => one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watchlist_run
      WHERE watchlist_id = ?
        AND trigger_type = ?
        AND idempotency_key IS NOT NULL
        AND status IN ('pending', 'running')
      ORDER BY queued_at ASC, started_at ASC, id ASC
      LIMIT 1
    `,
    input.watchlistId,
    input.triggerType,
  );

  const insertedRunId = await insertPendingRun();
  if (insertedRunId) {
    return { runId: insertedRunId, created: true as const };
  }

  const existing = await findExistingByExecutionKey();
  if (existing?.id) {
    return { runId: existing.id, created: false as const };
  }

  if (input.allowActiveRunFallback !== false) {
    const active = await findActiveRun();
    if (active?.id) {
      return { runId: active.id, created: false as const };
    }
  }

  const retriedRunId = await insertPendingRun();
  if (retriedRunId) {
    return { runId: retriedRunId, created: true as const };
  }

  const retryExisting = await findExistingByExecutionKey();
  if (retryExisting?.id) {
    return { runId: retryExisting.id, created: false as const };
  }

  if (input.allowActiveRunFallback !== false) {
    const retryActive = await findActiveRun();
    if (retryActive?.id) {
      return { runId: retryActive.id, created: false as const };
    }
  }

  throw new Error("Failed to create or locate orchestrated watchlist run.");
}

export async function markOrchestratedRunDispatched(
  env: AppEnv,
  input: {
    runId: string;
    workflowInstanceId: string;
  },
) {
  const timestamp = nowIso();
  const result = await runStatement(
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
  return Number(result.meta?.changes ?? 0) === 1;
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
          processing_token = NULL,
          processing_started_at = NULL,
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
    /**
     * Scheduled claims participate in the durable queue ranking. Interactive
     * claims (first scans and manual refreshes) use the same bounded slot
     * table but intentionally do not enter that scheduled queue.
     */
    mode?: "scheduled" | "interactive";
  },
) {
  const maxSlots = resolveEffectiveMonitoringFanoutMaxInflight(env);
  const leaseMs = input.leaseMs ?? resolveMonitoringConcurrencySlotLeaseMs(env);
  const token = createProcessingToken();
  const timestamp = nowIso();
  const staleBefore = new Date(Date.now() - leaseMs).toISOString();

  if (input.mode !== "interactive") {
    const eligible = await isRunEligibleForConcurrencyClaim(env, input.runId);
    if (!eligible) {
      return { claimed: false as const, reason: "queue_not_ready" as const };
    }
  } else {
    // A retry of a crashed first scan reuses its durable run id. Allow that
    // same run to reclaim an expired lease, but never let two live attempts
    // for the same run consume multiple fleet slots.
    const existing = await one<{ leased_at: string | null }>(
      env,
      `
        SELECT leased_at
        FROM monitoring_concurrency_slot
        WHERE holder_run_id = ?
        LIMIT 1
      `,
      input.runId,
    );
    if (existing?.leased_at && existing.leased_at >= staleBefore) {
      return { claimed: false as const, reason: "already_held" as const };
    }
  }

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
    maxAttempts?: number;
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
        AND (? IS NULL OR attempt_count < ?)
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
    input.maxAttempts ?? null,
    input.maxAttempts ?? null,
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
    touchWatchlistId?: string;
  },
) {
  const timestamp = nowIso();
  const summaryJson = JSON.stringify(input.summary);
  if (input.status === "succeeded" && input.touchWatchlistId) {
    const db = ensureDb(env);
    const billingCanaryGuard = await billingCanaryMutationGuardSql(env, "watchlist.user_id");
    if (typeof db.batch !== "function") {
      throw new Error(
        "D1 batch is required to atomically finalize an orchestrated scan and its watchlist.",
      );
    }
    const touchWatchlist = db
      .prepare(
        `
          UPDATE watchlist
          SET last_scanned_at = ?, updated_at = ?
          WHERE id = ?
            ${billingCanaryGuard}
            AND EXISTS (
              SELECT 1
              FROM watchlist_run
              WHERE watchlist_run.id = ?
                AND watchlist_run.watchlist_id = watchlist.id
                AND watchlist_run.processing_token = ?
                AND watchlist_run.status = 'running'
            )
        `,
      )
      .bind(
        timestamp,
        timestamp,
        input.touchWatchlistId,
        input.runId,
        input.processingToken,
      );
    const finishRun = db
      .prepare(
        `
          UPDATE watchlist_run
          SET status = 'succeeded',
              pages_scanned = ?,
              summary_json = CASE
                WHEN COALESCE(json_extract(summary_json, '$.firstScanQuotaReserved'), 0) = 1
                THEN json_set(?, '$.firstScanQuotaReserved', 1)
                ELSE ?
              END,
              finished_at = ?,
              error_code = NULL,
              error_message = NULL,
              processing_token = NULL,
              processing_started_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND watchlist_id = ?
            AND processing_token = ?
            AND status = 'running'
            AND EXISTS (
              SELECT 1
              FROM watchlist
              WHERE watchlist.id = watchlist_run.watchlist_id
                AND watchlist.last_scanned_at = ?
            )
        `,
      )
      .bind(
        input.pagesScanned,
        summaryJson,
        summaryJson,
        timestamp,
        timestamp,
        input.runId,
        input.touchWatchlistId,
        input.processingToken,
        timestamp,
      );
    const results = await db.batch([touchWatchlist, finishRun]);
    return results.length === 2 && results.every(
      (result) => Number(result.meta?.changes ?? 0) === 1,
    );
  }

  const result = await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET status = ?,
          pages_scanned = ?,
          summary_json = CASE
            WHEN COALESCE(json_extract(summary_json, '$.firstScanQuotaReserved'), 0) = 1
            THEN json_set(?, '$.firstScanQuotaReserved', 1)
            ELSE ?
          END,
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
    summaryJson,
    summaryJson,
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

/**
 * A manual refresh must not race a durable scheduled run that is still queued
 * or owned by another Workflow attempt. Unlike the legacy in-flight helper,
 * this intentionally has no age cutoff: a queued run can be older than the
 * ten-minute manual guard while still being a live durable claim.
 */
export async function hasActiveScheduledWatchlistRun(
  env: AppEnv,
  watchlistId: string,
) {
  if (!env.DB || typeof env.DB.prepare !== "function") {
    return false;
  }
  const row = await one<{ id: string }>(
    env,
    `
      SELECT id
      FROM watchlist_run
      WHERE watchlist_id = ?
        AND trigger_type = 'scheduled'
        AND status IN ('pending', 'running')
      LIMIT 1
    `,
    watchlistId,
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
          attempt_count,
          queued_at,
          started_at,
          created_at
        FROM watchlist_run
        WHERE trigger_type = 'scheduled'
          AND idempotency_key IS NOT NULL
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
  const access = await evaluateScheduledBrowserAccess(env, watchlist.userId);
  if (!access.eligible) {
    return { eligible: false as const, reason: access.reason };
  }
  return { eligible: true as const, plan: access.plan };
}

type WorkflowBinding = Workflow<MonitoringWorkflowParams> & {
  createBatch?: (
    batch: Array<{ id: string; params: MonitoringWorkflowParams }>,
  ) => Promise<Array<{ id: string }>>;
};

export type MonitoringWorkflowDispatchStatus =
  | "accepted"
  | "active"
  | "restarted"
  | "failed";

export interface MonitoringWorkflowDispatchOutcome {
  runId: string;
  status: MonitoringWorkflowDispatchStatus;
  error?: string;
}

function getMonitoringWorkflowBinding(env: AppEnv) {
  return env.MONITORING_WORKFLOW as WorkflowBinding | undefined;
}

function firstScanDispatchErrorCode(error: unknown) {
  return isRateLimitWorkflowError(error)
    ? "dispatch_rate_limited"
    : "first_scan_dispatch_failed";
}

async function readFirstScanDispatchState(
  env: AppEnv,
  descriptor: FirstWatchlistScanRunDescriptor,
) {
  return one<{
    status: WatchlistRunRecord["status"];
    watchlist_id: string;
    idempotency_key: string | null;
    workflow_instance_id: string | null;
    error_code: string | null;
    attempt_count: number;
  }>(
    env,
    `
      SELECT status, watchlist_id, idempotency_key, workflow_instance_id, error_code, attempt_count
      FROM watchlist_run
      WHERE id = ?
      LIMIT 1
    `,
    descriptor.runId,
  );
}

/**
 * Hands a persisted activation scan to the existing Workflow binding and only
 * reports queued after Cloudflare accepts (or already owns) the deterministic
 * instance ID. A failed handoff leaves the D1 row pending for reconciliation.
 */
export async function dispatchFirstWatchlistScanWorkflow(
  env: AppEnv,
  descriptor: FirstWatchlistScanRunDescriptor,
) {
  const expectedWorkflowInstanceId = await buildMonitoringWorkflowInstanceId(
    descriptor.executionKey,
  );
  if (descriptor.workflowInstanceId !== expectedWorkflowInstanceId) {
    throw new Error("The activation scan Workflow ID does not match its execution key.");
  }
  let state = await readFirstScanDispatchState(env, descriptor);
  if (
    !state ||
    state.watchlist_id !== descriptor.watchlistId ||
    state.idempotency_key !== descriptor.executionKey
  ) {
    throw new Error("The persisted activation scan no longer matches its dispatch descriptor.");
  }
  if (
    state.workflow_instance_id &&
    state.workflow_instance_id !== expectedWorkflowInstanceId
  ) {
    throw new Error("The persisted activation scan is bound to a different Workflow instance.");
  }

  if (
    state.attempt_count >= FIRST_SCAN_MAX_ATTEMPTS &&
    state.status !== "running"
  ) {
    const timestamp = nowIso();
    await runStatement(
      env,
      `
        UPDATE watchlist_run
        SET status = 'failed',
            finished_at = COALESCE(finished_at, ?),
            error_code = 'first_scan_retry_exhausted',
            error_message = 'The activation scan exhausted its bounded retry budget.',
            retry_after = NULL,
            processing_token = NULL,
            processing_started_at = NULL,
            updated_at = ?
        WHERE id = ?
          AND status IN ('pending', 'failed')
          AND attempt_count >= ?
      `,
      timestamp,
      timestamp,
      descriptor.runId,
      FIRST_SCAN_MAX_ATTEMPTS,
    );
    return { status: "terminal" as const, runId: descriptor.runId };
  }

  if (
    state.status === "failed" &&
    state.error_code &&
    RETRYABLE_FIRST_SCAN_ERROR_CODES.has(state.error_code) &&
    state.attempt_count < FIRST_SCAN_MAX_ATTEMPTS
  ) {
    const timestamp = nowIso();
    await runStatement(
      env,
      `
        UPDATE watchlist_run
        SET status = 'pending',
            finished_at = NULL,
            processing_token = NULL,
            processing_started_at = NULL,
            retry_after = NULL,
            updated_at = ?
        WHERE id = ?
          AND status = 'failed'
          AND error_code = ?
      `,
      timestamp,
      descriptor.runId,
      state.error_code,
    );
    state = await readFirstScanDispatchState(env, descriptor);
  }

  if (!state || !["pending", "running"].includes(state.status)) {
    return { status: "terminal" as const, runId: descriptor.runId };
  }

  const workflow = getMonitoringWorkflowBinding(env);
  if (
    !workflow ||
    typeof workflow.create !== "function" ||
    typeof workflow.get !== "function"
  ) {
    const error = new Error("MONITORING_WORKFLOW binding is not configured.");
    await markOrchestratedDispatchFailure(env, {
      runId: descriptor.runId,
      errorCode: "workflow_binding_missing",
      errorMessage: error.message,
      retryAfterIso: new Date(Date.now() + 60_000).toISOString(),
    });
    throw error;
  }

  const params: FirstWatchlistScanWorkflowParams = {
    kind: "first_scan",
    ...descriptor,
  };

  // Bind the deterministic Workflow identity before Cloudflare can begin the
  // accepted instance. A Workflow payload therefore never outruns the D1
  // identity check at the start of execution. Failed creates keep this stable
  // identity for reconciliation and replay.
  const dispatched = await markOrchestratedRunDispatched(env, {
    runId: descriptor.runId,
    workflowInstanceId: descriptor.workflowInstanceId,
  });
  if (!dispatched) {
    throw new Error("The activation scan durable Workflow binding was lost before dispatch.");
  }

  let accepted: "created" | "existing" | "restarted" = "created";
  try {
    await workflow.create({ id: descriptor.workflowInstanceId, params });
  } catch (createError) {
    try {
      const existing = await workflow.get(descriptor.workflowInstanceId);
      const current = await existing.status();
      if (current.status === "errored" || current.status === "terminated") {
        await existing.restart();
        accepted = "restarted";
      } else if (current.status !== "unknown") {
        accepted = "existing";
      } else {
        throw createError;
      }
    } catch {
      await markOrchestratedDispatchFailure(env, {
        runId: descriptor.runId,
        errorCode: firstScanDispatchErrorCode(createError),
        errorMessage:
          createError instanceof Error ? createError.message : "Activation scan dispatch failed.",
        retryAfterIso: new Date(Date.now() + 60_000).toISOString(),
      });
      throw createError;
    }
  }

  return { status: accepted, runId: descriptor.runId };
}

export async function reconcileFirstWatchlistScanRuns(
  env: AppEnv,
  input: { leaseMs?: number; limit?: number } = {},
) {
  const leaseMs = input.leaseMs ?? resolveMonitoringOrchestrationLeaseMs(env);
  const staleBefore = new Date(Date.now() - leaseMs).toISOString();
  const limit = input.limit ?? MONITORING_RECONCILIATION_LIMIT;
  const exhaustedAt = nowIso();
  await runStatement(
    env,
    `
      UPDATE watchlist_run
      SET status = 'failed',
          finished_at = COALESCE(finished_at, ?),
          error_code = 'first_scan_retry_exhausted',
          error_message = 'The activation scan exhausted its bounded retry budget.',
          retry_after = NULL,
          processing_token = NULL,
          processing_started_at = NULL,
          updated_at = ?
      WHERE trigger_type = 'manual'
        AND idempotency_key LIKE 'watchlist-run:first-scan:%'
        AND attempt_count >= ?
        AND (
          status = 'pending'
          OR status = 'failed'
          OR (status = 'running' AND processing_started_at < ?)
        )
    `,
    exhaustedAt,
    exhaustedAt,
    FIRST_SCAN_MAX_ATTEMPTS,
    staleBefore,
  );
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
          attempt_count,
          queued_at,
          started_at,
          created_at,
          error_code,
          retry_after
        FROM watchlist_run
        WHERE trigger_type = 'manual'
          AND idempotency_key LIKE 'watchlist-run:first-scan:%'
          AND attempt_count < ?
          AND (
            (status = 'pending' AND (retry_after IS NULL OR retry_after <= ?))
            OR (status = 'running' AND processing_started_at IS NOT NULL AND processing_started_at < ?)
            OR (status = 'failed' AND error_code IN (
              'browser_launch_failed',
              'concurrency_limited',
              'dispatch_rate_limited',
              'first_scan_dispatch_failed',
              'first_scan_setup_failed',
              'rate_limited',
              'retryable_scan_failure',
              'workflow_binding_missing'
            ))
          )
        ORDER BY queue_priority ASC, queued_at ASC, started_at ASC, id ASC
        LIMIT ?
      `,
    )
    .bind(FIRST_SCAN_MAX_ATTEMPTS, nowIso(), staleBefore, limit)
    .all<FirstScanReconciliationRow>();

  let redispatched = 0;
  let cancelled = 0;
  let failures = 0;
  for (const row of result.results ?? []) {
    if (!row.idempotency_key) {
      continue;
    }
    const watchlist = await getWatchlist(env, row.watchlist_id);
    if (!watchlist || !watchlist.isActive) {
      const timestamp = nowIso();
      const cancellation = await runStatement(
        env,
        `
          UPDATE watchlist_run
          SET status = 'skipped',
              finished_at = ?,
              error_code = 'watchlist_unavailable',
              error_message = 'This competitor is no longer being tracked.',
              processing_token = NULL,
              processing_started_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND idempotency_key = ?
            AND (
              status IN ('pending', 'failed')
              OR (status = 'running' AND processing_started_at < ?)
            )
        `,
        timestamp,
        timestamp,
        row.id,
        row.idempotency_key,
        staleBefore,
      );
      cancelled += Number(cancellation.meta?.changes ?? 0);
      continue;
    }

    const descriptor: FirstWatchlistScanRunDescriptor = {
      runId: row.id,
      watchlistId: row.watchlist_id,
      executionKey: row.idempotency_key,
      workflowInstanceId:
        await buildMonitoringWorkflowInstanceId(row.idempotency_key),
      queuedAt: row.queued_at ?? row.started_at ?? row.created_at ?? nowIso(),
    };
    try {
      const dispatch = await dispatchFirstWatchlistScanWorkflow(env, descriptor);
      if (dispatch.status !== "terminal") {
        redispatched += 1;
      }
    } catch (error) {
      failures += 1;
      logAppEvent("error", "first_scan_reconcile_failed", "Activation scan reconciliation failed", {
        details: {
          runId: row.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return { redispatched, cancelled, failures };
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
}): ScheduledMonitoringWorkflowParams {
  const queuedAt = new Date(input.scheduledTime).toISOString();
  return {
    kind: "scheduled_scan",
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
      outcomes: [] as MonitoringWorkflowDispatchOutcome[],
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
      outcomes: input.jobs.map((job) => ({
        runId: job.runId,
        status: "failed" as const,
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
      outcomes: input.jobs.map((job) => ({
        runId: job.runId,
        status: "failed" as const,
        error: "MONITORING_WORKFLOW.createBatch is not available.",
      })),
      createBatchMissing: true as const,
    };
  }

  // Bind the durable identity before Cloudflare can accept an instance. This
  // mirrors the first-scan handoff and prevents a terminal/out-of-order D1
  // row from leaving an orphan Workflow running against no owner.
  const dispatchableJobs: typeof input.jobs = [];
  const failures: Array<{ runId: string; error: string }> = [];
  const outcomes: MonitoringWorkflowDispatchOutcome[] = [];
  for (const job of input.jobs) {
    const bound = await markOrchestratedRunDispatched(env, {
      runId: job.runId,
      workflowInstanceId: job.workflowInstanceId,
    });
    if (bound) {
      dispatchableJobs.push(job);
    } else {
      const error = "The scheduled scan durable Workflow binding was lost before dispatch.";
      failures.push({
        runId: job.runId,
        error,
      });
      outcomes.push({ runId: job.runId, status: "failed", error });
    }
  }

  if (dispatchableJobs.length === 0) {
    return {
      dispatched: 0,
      duplicates: 0,
      failures,
      outcomes,
    };
  }

  const batch = dispatchableJobs.map((job) => ({
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
        failures: [
          ...failures,
          ...dispatchableJobs.map((job) => ({
            runId: job.runId,
            error: error instanceof Error ? error.message : "Workflow rate limited.",
          })),
        ],
        outcomes: [
          ...outcomes,
          ...dispatchableJobs.map((job) => ({
            runId: job.runId,
            status: "failed" as const,
            error: error instanceof Error ? error.message : "Workflow rate limited.",
          })),
        ],
        rateLimited: true as const,
      };
    }
    throw error;
  }

  let dispatched = 0;
  let duplicates = 0;
  for (const job of dispatchableJobs) {
    if (createdIds.has(job.workflowInstanceId)) {
      dispatched += 1;
      outcomes.push({ runId: job.runId, status: "accepted" });
      continue;
    }

    if (typeof workflow.get !== "function") {
      const error = "MONITORING_WORKFLOW.get is not available.";
      failures.push({ runId: job.runId, error });
      outcomes.push({ runId: job.runId, status: "failed", error });
      continue;
    }

    try {
      const existing = await workflow.get(job.workflowInstanceId);
      const current = await existing.status();
      if (current.status === "errored" || current.status === "terminated") {
        await existing.restart();
        dispatched += 1;
        outcomes.push({ runId: job.runId, status: "restarted" });
      } else if (current.status === "unknown") {
        const error = "Workflow instance status is unknown.";
        failures.push({ runId: job.runId, error });
        outcomes.push({ runId: job.runId, status: "failed", error });
      } else {
        duplicates += 1;
        outcomes.push({ runId: job.runId, status: "active" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow instance lookup failed.";
      failures.push({ runId: job.runId, error: message });
      outcomes.push({ runId: job.runId, status: "failed", error: message });
    }
  }

  return { dispatched, duplicates, failures, outcomes };
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
  if (input.shadowOnly) {
    return { status: "shadow" as const };
  }
  return result.outcomes[0] ?? {
    runId: input.runId,
    status: "failed" as const,
    error: result.failures[0]?.error ?? "Workflow dispatch failed.",
  };
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
        queuePriority: getScheduledMonitoringPolicy(eligibility.plan).monitoringQueuePriority,
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
  const firstScans = await reconcileFirstWatchlistScanRuns(env, {
    leaseMs: input.leaseMs,
  });
  if (input.mode === "inline") {
    const cancelled = await cancelOrchestratedRunsForInlineRollback(env);
    return {
      recovered: 0,
      cancelled,
      redispatched: 0,
      redispatchFailures: 0,
      firstScans,
    };
  }

  const leaseMs = input.leaseMs ?? resolveMonitoringOrchestrationLeaseMs(env);
  const maxAgeMs = resolveMonitoringOrchestrationMaxAgeMs(env);
  const shadowOnly = input.mode === "shadow";
  const staleRuns = await listOrchestratedRunsForReconciliation(env, { leaseMs });
  let recovered = 0;
  let cancelled = 0;
  let redispatched = 0;
  let redispatchFailures = 0;

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

    const access = await evaluateScheduledBrowserAccess(env, watchlist.user_id);
    if (!access.eligible) {
      await markOrchestratedRunCancelled(env, {
        runId: row.id,
        reason: access.reason,
        message: "Scheduled scans paused for this workspace.",
      });
      cancelled += 1;
      continue;
    }

    const runCreatedAt = Date.parse(row.queued_at ?? row.started_at ?? row.created_at ?? "");
    if (row.status === "running" && Number.isFinite(runCreatedAt) && Date.now() - runCreatedAt > maxAgeMs) {
      await markOrchestratedRunCancelled(env, {
        runId: row.id,
        reason: "orchestration_stale",
        message: "Scheduled scan was older than the orchestration recovery window.",
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
      const dispatch = await dispatchOrchestratedWatchlistJob(env, {
        watchlist: watchlistRecord,
        runId: row.id,
        executionKey: row.idempotency_key,
        workflowInstanceId,
        triggerType: "scheduled",
        scheduledTime: input.scheduledTime ?? Date.now(),
        cron: input.cron,
        shadowOnly,
      });
      if (dispatch.status === "accepted" || dispatch.status === "restarted") {
        redispatched += 1;
      } else if (dispatch.status === "failed") {
        redispatchFailures += 1;
        await markOrchestratedDispatchFailure(env, {
          runId: row.id,
          errorCode: "reconcile_dispatch_failed",
          errorMessage: dispatch.error ?? "Re-dispatch failed.",
        });
      }
    } catch (error) {
      redispatchFailures += 1;
      await markOrchestratedDispatchFailure(env, {
        runId: row.id,
        errorCode: isRateLimitWorkflowError(error) ? "dispatch_rate_limited" : "reconcile_dispatch_failed",
        errorMessage: error instanceof Error ? error.message : "Re-dispatch failed.",
      });
    }
  }

  return { recovered, cancelled, redispatched, redispatchFailures, firstScans };
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
          AND idempotency_key IS NOT NULL
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
