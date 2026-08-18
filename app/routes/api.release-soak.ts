import type { ActionFunctionArgs } from "react-router";

import {
  readReleaseIdentity,
  verifyExpectedCanaryWorkerVersion,
} from "~/lib/canary-release-identity.server";
import type { AppEnv } from "~/lib/env.server";
import {
  RELEASE_SCHEDULE_CRONS,
  expectedReleaseSchedule,
  type ReleaseScheduledTaskName,
} from "~/lib/release-scheduled-observation-contract";

const SOAK_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 512;
const MAX_TASK_DURATION_MS = 15 * 60 * 1000;
const MAX_SCHEDULED_RUN_COMPLETION_MS = 2 * 60 * 60 * 1000;
const MAX_DIGEST_JOB_COMPLETION_MS = 2 * 60 * 60 * 1000;
const SAFE_TASKS = new Set<ReleaseScheduledTaskName>([
  "billing_lifecycle_email_recovery",
  "weekly_business_numbers",
  "digest_schedule_exhaustion_recovery",
  "digest_schedule_recovery",
  "discovery_warmup",
  "monitoring_fanout_reconciliation",
  "instant_alert_flush",
  "retention_sweep",
  "presence_polling_batch",
  "scheduled_monitoring",
  "customer_at_risk_alert",
]);
const SAFE_CRONS = new Set<string>(RELEASE_SCHEDULE_CRONS);

type ObservationRow = {
  cron: string;
  task_name: string;
  scheduled_at: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  outcome: "completed" | "no_work" | "degraded" | "threw";
  failure_category: "timeout" | "runtime_error" | "non_error_throw" | null;
  metrics_json: string;
};

type ScheduledRunSlo = {
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  pendingRuns: number;
  runningRuns: number;
  skippedRuns: number;
  degradedRuns: number;
  maxCompletionMs: number;
};

type DigestJobSlo = {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
  runningJobs: number;
  exhaustedJobs: number;
  retriedJobs: number;
  deliveryAttempts: number;
  sentDeliveryAttempts: number;
  unresolvedDeliveryAttempts: number;
  maxCompletionMs: number;
};

function hasValidToken(request: Request, token: string | undefined) {
  const configured = token?.trim();
  return Boolean(configured && request.headers.get("x-0509-canary-token") === configured);
}

function hasCanonicalOrigin(request: Request) {
  try {
    const url = new URL(request.url);
    const authority = request.url.match(/^https:\/\/([^/?#]+)/iu)?.[1]?.toLowerCase();
    return url.origin === "https://0509.io" && authority === "0509.io" && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function parseIso(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function readWindow(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "startedAt" && key !== "endedAt")) return null;
  const startedAt = parseIso(value.startedAt);
  const endedAt = parseIso(value.endedAt);
  if (startedAt === null || endedAt === null || endedAt - startedAt !== SOAK_DURATION_MS) return null;
  return {
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    startedAtMs: startedAt,
    endedAtMs: endedAt,
  };
}

function safeMetrics(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 16 || entries.some(([key, metric]) =>
    !/^[A-Za-z][A-Za-z0-9]{0,39}$/u.test(key) ||
    (typeof metric !== "boolean" && !(Number.isSafeInteger(metric) && typeof metric === "number" && metric >= 0 && metric <= 1_000_000))
  )) return null;
  return Object.fromEntries(entries);
}

export function evaluateReleaseSoak(
  rows: ObservationRow[],
  input: { startedAtMs: number; endedAtMs: number },
  scheduledRunSlo: ScheduledRunSlo,
  digestJobSlo: DigestJobSlo,
) {
  const blockers = new Set<string>();
  const expected = expectedReleaseSchedule(input.startedAtMs, input.endedAtMs);
  const bySlot = new Map<string, ObservationRow[]>();
  const safeRows: Array<{
    cron: string;
    taskName: string;
    scheduledAt: string;
    durationMs: number;
    outcome: string;
    metrics: Record<string, unknown>;
  }> = [];

  for (const row of rows) {
    if (!SAFE_CRONS.has(row.cron)) {
      blockers.add("unsafe_task_cron");
      continue;
    }
    if (!SAFE_TASKS.has(row.task_name as ReleaseScheduledTaskName)) {
      blockers.add("unsafe_task_observation");
      continue;
    }
    const metrics = safeMetrics(row.metrics_json);
    if (!metrics) {
      blockers.add("unsafe_task_metrics");
      continue;
    }
    const scheduledAtMs = parseIso(row.scheduled_at);
    const startedAtMs = parseIso(row.started_at);
    const completedAtMs = parseIso(row.completed_at);
    if (scheduledAtMs === null || startedAtMs === null || completedAtMs === null) {
      blockers.add("invalid_task_timestamp");
      continue;
    }
    if (!Number.isSafeInteger(row.duration_ms) || row.duration_ms < 0 || row.duration_ms > MAX_TASK_DURATION_MS) {
      blockers.add("task_duration_slo_failed");
    }
    if (completedAtMs - scheduledAtMs > MAX_TASK_DURATION_MS || completedAtMs < scheduledAtMs) {
      blockers.add("task_freshness_slo_failed");
    }
    if (row.outcome === "degraded" || row.outcome === "threw" || row.failure_category !== null) {
      blockers.add("task_outcome_slo_failed");
    }
    const key = `${row.cron}\u0000${row.task_name}\u0000${row.scheduled_at}`;
    const matching = bySlot.get(key) ?? [];
    matching.push(row);
    bySlot.set(key, matching);
    safeRows.push({
      cron: row.cron,
      taskName: row.task_name,
      scheduledAt: row.scheduled_at,
      durationMs: row.duration_ms,
      outcome: row.outcome,
      metrics,
    });
  }

  for (const slot of expected) {
    const key = `${slot.cron}\u0000${slot.taskName}\u0000${slot.scheduledAt}`;
    const matching = bySlot.get(key) ?? [];
    if (matching.length === 0) blockers.add("scheduled_task_observation_missing");
    if (matching.length > 1) blockers.add("scheduled_task_duplicate_attempt");
    bySlot.delete(key);
  }

  for (const [key, matching] of bySlot) {
    if (matching.length > 1) blockers.add("scheduled_task_duplicate_attempt");
    else blockers.add("unexpected_scheduled_task_observation");
  }

  const regularScanSuccesses = safeRows
    .filter((row) => row.cron === "0 */3 * * *" && row.taskName === "scheduled_monitoring")
    .reduce((total, row) => total + Number(row.metrics.queued ?? 0) + Number(row.metrics.inlineRuns ?? 0), 0);
  const dailyDigestSuccesses = safeRows
    .filter((row) => row.cron === "0 4 * * *" && row.taskName === "scheduled_monitoring")
    .reduce((total, row) => total + Number(row.metrics.digests ?? 0), 0);
  if (regularScanSuccesses === 0) blockers.add("scheduled_scan_success_missing");
  if (dailyDigestSuccesses === 0) blockers.add("scheduled_digest_success_missing");
  if (scheduledRunSlo.totalRuns !== regularScanSuccesses) blockers.add("scheduled_run_count_mismatch");
  if (scheduledRunSlo.succeededRuns !== scheduledRunSlo.totalRuns || scheduledRunSlo.succeededRuns === 0) {
    blockers.add("scheduled_run_success_slo_failed");
  }
  if (
    scheduledRunSlo.failedRuns > 0 || scheduledRunSlo.pendingRuns > 0 ||
    scheduledRunSlo.runningRuns > 0 || scheduledRunSlo.skippedRuns > 0 ||
    scheduledRunSlo.degradedRuns > 0
  ) blockers.add("scheduled_run_terminal_slo_failed");
  if (
    !Number.isSafeInteger(scheduledRunSlo.maxCompletionMs) ||
    scheduledRunSlo.maxCompletionMs < 0 ||
    scheduledRunSlo.maxCompletionMs > MAX_SCHEDULED_RUN_COMPLETION_MS
  ) blockers.add("scheduled_run_freshness_slo_failed");
  if (digestJobSlo.totalJobs === 0 || digestJobSlo.completedJobs !== digestJobSlo.totalJobs) {
    blockers.add("digest_job_success_slo_failed");
  }
  if (
    digestJobSlo.failedJobs > 0 || digestJobSlo.pendingJobs > 0 ||
    digestJobSlo.runningJobs > 0 || digestJobSlo.exhaustedJobs > 0 ||
    digestJobSlo.retriedJobs > 0
  ) blockers.add("digest_job_terminal_slo_failed");
  if (
    digestJobSlo.deliveryAttempts === 0 || digestJobSlo.sentDeliveryAttempts === 0 ||
    digestJobSlo.unresolvedDeliveryAttempts > 0 ||
    digestJobSlo.sentDeliveryAttempts !== digestJobSlo.deliveryAttempts
  ) blockers.add("digest_delivery_acceptance_slo_failed");
  if (
    !Number.isSafeInteger(digestJobSlo.maxCompletionMs) ||
    digestJobSlo.maxCompletionMs < 0 ||
    digestJobSlo.maxCompletionMs > MAX_DIGEST_JOB_COMPLETION_MS
  ) blockers.add("digest_job_freshness_slo_failed");

  safeRows.sort((left, right) =>
    left.scheduledAt.localeCompare(right.scheduledAt) || left.taskName.localeCompare(right.taskName)
  );
  return {
    passed: blockers.size === 0,
    blockers: [...blockers].sort(),
    expectedObservations: expected.length,
    observedObservations: safeRows.length,
    maxTaskDurationMs: safeRows.reduce((maximum, row) => Math.max(maximum, row.durationMs), 0),
    regularScanSuccesses,
    dailyDigestSuccesses,
    scheduledRuns: scheduledRunSlo,
    digestJobs: digestJobSlo,
    observations: safeRows,
  };
}

function safeAggregate(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000 ? number : null;
}

async function loadScheduledRunSlo(env: AppEnv, startedAt: string, endedAt: string) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total_runs,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded_runs,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_runs,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_runs,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_runs,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_runs,
        SUM(CASE WHEN json_extract(summary_json, '$.scanStatus') = 'degraded' THEN 1 ELSE 0 END) AS degraded_runs,
        COALESCE(MAX(CASE
          WHEN finished_at IS NOT NULL
          THEN CAST(ROUND((julianday(finished_at) - julianday(started_at)) * 86400000) AS INTEGER)
          ELSE 0
        END), 0) AS max_completion_ms
      FROM watchlist_run
      WHERE trigger_type = 'scheduled'
        AND started_at >= ?
        AND started_at < ?
    `).bind(startedAt, endedAt).first<Record<string, unknown>>();
  if (!row) return null;
  const values = [
    row.total_runs,
    row.succeeded_runs,
    row.failed_runs,
    row.pending_runs,
    row.running_runs,
    row.skipped_runs,
    row.degraded_runs,
    row.max_completion_ms,
  ].map(safeAggregate);
  if (values.some((value) => value === null)) return null;
  return {
    totalRuns: values[0]!,
    succeededRuns: values[1]!,
    failedRuns: values[2]!,
    pendingRuns: values[3]!,
    runningRuns: values[4]!,
    skippedRuns: values[5]!,
    degradedRuns: values[6]!,
    maxCompletionMs: values[7]!,
  };
}

async function loadDigestJobSlo(env: AppEnv, startedAt: string, endedAt: string) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`
      WITH jobs AS (
        SELECT status, attempt_count, created_at, completed_at
        FROM digest_schedule_job
        WHERE period_end >= ?
          AND period_end < ?
      ), attempts AS (
        SELECT delivery_attempt.status
        FROM delivery_attempt
        INNER JOIN digest_run ON digest_run.id = delivery_attempt.digest_run_id
        WHERE delivery_attempt.lane = 'customer'
          AND digest_run.period_end >= ?
          AND digest_run.period_end < ?
      )
      SELECT
        (SELECT COUNT(*) FROM jobs) AS total_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'completed') AS completed_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'failed') AS failed_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'pending') AS pending_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'running') AS running_jobs,
        (SELECT COUNT(*) FROM jobs WHERE status = 'exhausted') AS exhausted_jobs,
        (SELECT COUNT(*) FROM jobs WHERE attempt_count > 1) AS retried_jobs,
        (SELECT COUNT(*) FROM attempts) AS delivery_attempts,
        (SELECT COUNT(*) FROM attempts WHERE status = 'sent') AS sent_delivery_attempts,
        (SELECT COUNT(*) FROM attempts WHERE status <> 'sent') AS unresolved_delivery_attempts,
        COALESCE(MAX(CASE
          WHEN completed_at IS NOT NULL
          THEN CAST(ROUND((julianday(completed_at) - julianday(created_at)) * 86400000) AS INTEGER)
          ELSE 0
        END), 0) AS max_completion_ms
      FROM jobs
    `).bind(startedAt, endedAt, startedAt, endedAt).first<Record<string, unknown>>();
  if (!row) return null;
  const values = [
    row.total_jobs,
    row.completed_jobs,
    row.failed_jobs,
    row.pending_jobs,
    row.running_jobs,
    row.exhausted_jobs,
    row.retried_jobs,
    row.delivery_attempts,
    row.sent_delivery_attempts,
    row.unresolved_delivery_attempts,
    row.max_completion_ms,
  ].map(safeAggregate);
  if (values.some((value) => value === null)) return null;
  return {
    totalJobs: values[0]!,
    completedJobs: values[1]!,
    failedJobs: values[2]!,
    pendingJobs: values[3]!,
    runningJobs: values[4]!,
    exhaustedJobs: values[5]!,
    retriedJobs: values[6]!,
    deliveryAttempts: values[7]!,
    sentDeliveryAttempts: values[8]!,
    unresolvedDeliveryAttempts: values[9]!,
    maxCompletionMs: values[10]!,
  };
}

async function loadObservations(env: AppEnv, workerVersionId: string, startedAt: string, endedAt: string) {
  if (!env.DB) return null;
  const result = await env.DB.prepare(`
      SELECT cron, task_name, scheduled_at, started_at, completed_at,
             duration_ms, outcome, failure_category, metrics_json
      FROM release_scheduled_observation
      WHERE worker_version_id = ?
        AND scheduled_at >= ?
        AND scheduled_at < ?
      ORDER BY scheduled_at, task_name, completed_at
    `).bind(workerVersionId, startedAt, endedAt).all<ObservationRow>();
  return result.results ?? [];
}

export async function action({ context, request }: ActionFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const env = getEnv(context);
  if (!hasValidToken(request, env.CANARY_BYPASS_TOKEN) || !hasCanonicalOrigin(request)) {
    throw new Response("Not found", { status: 404 });
  }
  if (request.method !== "POST") {
    return Response.json({ ok: false, blocker: "soak_requires_post" }, {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" },
    });
  }
  const versionCheck = verifyExpectedCanaryWorkerVersion(request, env);
  if (!versionCheck.requested || !versionCheck.ok) {
    return Response.json({ ok: false, blocker: "worker_version_mismatch" }, {
      status: 409,
      headers: { "cache-control": "no-store" },
    });
  }
  const window = await readWindow(request);
  if (!window) {
    return Response.json({ ok: false, blocker: "invalid_soak_window" }, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  if (Date.now() < window.endedAtMs) {
    return Response.json({ ok: false, blocker: "soak_window_incomplete" }, {
      status: 425,
      headers: { "cache-control": "no-store" },
    });
  }
  const releaseIdentity = readReleaseIdentity(env);
  const workerVersionId = releaseIdentity.workerVersionId;
  if (!workerVersionId || releaseIdentity.searchRolloutMode !== "v2") {
    return Response.json({ ok: false, blocker: "release_identity_incomplete" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  let rows: ObservationRow[] | null;
  let scheduledRunSlo: ScheduledRunSlo | null;
  let digestJobSlo: DigestJobSlo | null;
  try {
    [rows, scheduledRunSlo, digestJobSlo] = await Promise.all([
      loadObservations(env, workerVersionId, window.startedAt, window.endedAt),
      loadScheduledRunSlo(env, window.startedAt, window.endedAt),
      loadDigestJobSlo(env, window.startedAt, window.endedAt),
    ]);
  } catch {
    rows = null;
    scheduledRunSlo = null;
    digestJobSlo = null;
  }
  if (!rows || !scheduledRunSlo || !digestJobSlo) {
    return Response.json({ ok: false, blocker: "soak_observations_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  const evaluation = evaluateReleaseSoak(rows, window, scheduledRunSlo, digestJobSlo);
  return Response.json({
    ok: evaluation.passed,
    schemaVersion: 1,
    evidenceClass: "exact_worker_scheduled_observation",
    workerVersionId,
    searchRolloutMode: "v2",
    window: { startedAt: window.startedAt, endedAt: window.endedAt, durationMs: SOAK_DURATION_MS },
    slo: {
      maxTaskDurationMs: MAX_TASK_DURATION_MS,
      maxScheduledRunCompletionMs: MAX_SCHEDULED_RUN_COMPLETION_MS,
      maxDigestJobCompletionMs: MAX_DIGEST_JOB_COMPLETION_MS,
      failures: 0,
      degraded: 0,
      duplicateAttempts: 0,
    },
    ...evaluation,
  }, {
    status: evaluation.passed ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
