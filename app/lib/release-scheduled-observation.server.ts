import type { AppEnv } from "~/lib/env.server";
import {
  RELEASE_SCHEDULE_CRONS,
  type ReleaseScheduledTaskName,
} from "~/lib/release-scheduled-observation-contract";
import { SCHEDULED_OBSERVATION_MAX_FUTURE_SKEW_MS } from "~/lib/scheduled-observation-health.server";

export type { ReleaseScheduledTaskName } from "~/lib/release-scheduled-observation-contract";

export type ReleaseScheduledObservationContext = {
  cron: string;
  scheduledTime: number;
};

type SafeMetricValue = number | boolean;
type SafeMetrics = Record<string, SafeMetricValue>;
type ReleaseScheduledOutcome = "completed" | "no_work" | "degraded" | "threw";
type FailureCategory = "timeout" | "runtime_error" | "non_error_throw";

type RecordInput = ReleaseScheduledObservationContext & {
  taskName: ReleaseScheduledTaskName;
  startedAt: Date;
  completedAt: Date;
  outcome: ReleaseScheduledOutcome;
  failureCategory: FailureCategory | null;
  metrics: SafeMetrics;
};

type ObservationDependencies = {
  now?: () => Date;
  randomUUID?: () => string;
  record?: (env: AppEnv, input: RecordInput) => Promise<void>;
  logObservationFailure?: (taskName: ReleaseScheduledTaskName) => void;
  logDegradedReportFailure?: (taskName: ReleaseScheduledTaskName) => void;
  reportDegraded?: (taskName: ReleaseScheduledTaskName) => Promise<unknown>;
};

const SAFE_WORKER_VERSION = /^[A-Za-z0-9._-]{1,128}$/u;
const SAFE_CRONS = new Set<string>(RELEASE_SCHEDULE_CRONS);
const MAX_SAFE_COUNT = 1_000_000;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeCount(value: unknown) {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= MAX_SAFE_COUNT
    ? value
    : 0;
}

function countTrueResults(value: unknown, expected: boolean) {
  return Array.isArray(value)
    ? value.filter((entry) => objectValue(entry).ok === expected).length
    : 0;
}

function sumSafeCounts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value).reduce((sum, count) => sum + safeCount(count), 0);
}

function hasAnyWork(metrics: SafeMetrics) {
  return Object.values(metrics).some((value) => value === true || (typeof value === "number" && value > 0));
}

export function classifyScheduledTaskResult(
  taskName: ReleaseScheduledTaskName,
  value: unknown,
): { outcome: Exclude<ReleaseScheduledOutcome, "threw">; metrics: SafeMetrics } {
  const result = objectValue(value);

  if (taskName === "billing_lifecycle_email_recovery") {
    const metrics = {
      scanned: safeCount(result.scanned),
      claimed: safeCount(result.claimed),
      sent: safeCount(result.sent),
      failed: safeCount(result.failed),
      providerUnknown: safeCount(result.providerUnknown),
      superseded: safeCount(result.superseded),
      conflicts: safeCount(result.conflicts),
    };
    const degraded = metrics.failed + metrics.providerUnknown + metrics.conflicts > 0;
    return { outcome: degraded ? "degraded" : metrics.claimed > 0 ? "completed" : "no_work", metrics };
  }

  if (taskName === "weekly_business_numbers") {
    const metrics = { sent: result.sent === true };
    return {
      outcome: metrics.sent
        ? "completed"
        : result.reason === "duplicate"
          ? "no_work"
          : "degraded",
      metrics,
    };
  }

  if (taskName === "customer_at_risk_alert") {
    const metrics = {
      sent: result.sent === true,
      signals: safeCount(result.signals),
    };
    return {
      outcome:
        metrics.signals === 0 || result.reason === "duplicate"
          ? "no_work"
          : metrics.sent
            ? "completed"
            : "degraded",
      metrics,
    };
  }

  if (taskName === "digest_schedule_exhaustion_recovery") {
    const metrics = {
      attempted: safeCount(result.attempted),
      alerted: safeCount(typeof value === "number" ? value : result.alerted),
      failures: safeCount(result.failed ?? result.failures),
    };
    return {
      outcome: metrics.failures > 0 ? "degraded" : metrics.alerted > 0 ? "completed" : "no_work",
      metrics,
    };
  }

  if (taskName === "digest_schedule_recovery") {
    const metrics = {
      attempted: safeCount(result.attempted),
      digests: safeCount(typeof value === "number" ? value : result.sent ?? result.digests),
      failures: safeCount(result.failed ?? result.failures),
    };
    return {
      outcome: metrics.failures > 0 ? "degraded" : metrics.digests > 0 ? "completed" : "no_work",
      metrics,
    };
  }

  if (taskName === "discovery_warmup") {
    const metrics = {
      attempted: safeCount(result.attempted),
      succeeded: safeCount(result.succeeded),
      failed: safeCount(result.failed),
      skipped: safeCount(result.skipped),
    };
    return {
      outcome: metrics.failed > 0 ? "degraded" : metrics.attempted > 0 ? "completed" : "no_work",
      metrics,
    };
  }

  if (taskName === "brand_page_refresh") {
    const metrics = {
      attempted: safeCount(result.attempted),
      succeeded: safeCount(result.succeeded),
      failed: safeCount(result.failed),
      skippedFresh: safeCount(result.skippedFresh),
      skippedBudget: safeCount(result.skippedBudget),
      observedIndexable: safeCount(result.observedIndexable),
    };
    return {
      outcome: metrics.failed > 0 ? "degraded" : metrics.attempted > 0 ? "completed" : "no_work",
      metrics,
    };
  }

  if (taskName === "monitoring_fanout_reconciliation") {
    const firstScans = objectValue(result.firstScans);
    const metrics = {
      recovered: safeCount(result.recovered),
      cancelled: safeCount(result.cancelled),
      redispatched: safeCount(result.redispatched),
      redispatchFailures: safeCount(result.redispatchFailures),
      firstScanRedispatched: safeCount(firstScans.redispatched),
      firstScanCancelled: safeCount(firstScans.cancelled),
      firstScanFailures: safeCount(firstScans.failures),
    };
    return {
      outcome:
        metrics.redispatchFailures + metrics.firstScanFailures > 0
          ? "degraded"
          : hasAnyWork(metrics)
            ? "completed"
            : "no_work",
      metrics,
    };
  }

  if (taskName === "instant_alert_flush") {
    const metrics = {
      groups: safeCount(result.groups),
      attempts: safeCount(result.attempts),
      failures: safeCount(result.failures),
    };
    return {
      outcome: metrics.failures > 0 ? "degraded" : metrics.groups > 0 ? "completed" : "no_work",
      metrics,
    };
  }

  if (taskName === "retention_sweep") {
    const metrics = {
      deleted: sumSafeCounts(result.deleted),
      failedSteps: Array.isArray(result.failedSteps) ? Math.min(result.failedSteps.length, MAX_SAFE_COUNT) : 0,
    };
    return {
      outcome: metrics.failedSteps > 0 ? "degraded" : metrics.deleted > 0 ? "completed" : "no_work",
      metrics,
    };
  }

  if (taskName === "presence_polling_batch") {
    const metrics = {
      polled: safeCount(result.polled),
      failed: countTrueResults(result.results, false),
      skippedRollout: safeCount(result.skippedRollout),
      spentUnits: safeCount(result.spentUnits),
    };
    return {
      outcome: metrics.failed > 0 ? "degraded" : metrics.polled > 0 ? "completed" : "no_work",
      metrics,
    };
  }

  if (taskName === "scheduled_monitoring") {
    const metrics = {
      queued: safeCount(result.queued),
      duplicates: safeCount(result.duplicates),
      inlineRuns: safeCount(result.inlineRuns),
      inlineFailures: safeCount(result.inlineFailures),
      skippedForBudget: safeCount(result.skippedForBudget),
      skippedForBilling: safeCount(result.skippedForBilling),
      dispatchFailures: safeCount(result.dispatchFailures),
      digests: safeCount(result.digests),
      digestAttempts: safeCount(result.digestAttempts),
      digestFailures: safeCount(result.digestFailures),
    };
    const degraded = metrics.inlineFailures + metrics.skippedForBudget + metrics.dispatchFailures + metrics.digestFailures > 0;
    const productive = metrics.queued + metrics.inlineRuns + metrics.digests > 0;
    return { outcome: degraded ? "degraded" : productive ? "completed" : "no_work", metrics };
  }

  const metrics = {
    sent: result.sent === true,
    signals: safeCount(result.signals),
  };
  return {
    outcome: metrics.signals === 0 ? "no_work" : metrics.sent ? "completed" : "degraded",
    metrics,
  };
}

export function safeScheduledFailureCategory(error: unknown): FailureCategory {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "PromiseTimeoutError")) {
    return "timeout";
  }
  return error instanceof Error ? "runtime_error" : "non_error_throw";
}

function validateRecordInput(input: RecordInput) {
  if (!SAFE_CRONS.has(input.cron)) throw new Error("unsafe_release_soak_cron");
  if (!Number.isSafeInteger(input.scheduledTime) || input.scheduledTime <= 0) {
    throw new Error("unsafe_release_soak_scheduled_time");
  }
  if (
    input.scheduledTime >
    input.completedAt.getTime() + SCHEDULED_OBSERVATION_MAX_FUTURE_SKEW_MS
  ) {
    throw new Error("unsafe_release_soak_future_scheduled_time");
  }
  const durationMs = input.completedAt.getTime() - input.startedAt.getTime();
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 900_000) {
    throw new Error("unsafe_release_soak_duration");
  }
  const metricsJson = JSON.stringify(input.metrics);
  if (metricsJson.length > 2048 || Object.values(input.metrics).some((value) =>
    typeof value === "number" && (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_COUNT)
  )) {
    throw new Error("unsafe_release_soak_metrics");
  }
  return { durationMs, metricsJson };
}

export async function recordReleaseScheduledObservation(
  env: AppEnv,
  input: RecordInput,
  dependencies: Pick<ObservationDependencies, "randomUUID"> = {},
) {
  const workerVersionId = env.CF_VERSION_METADATA?.id?.trim() ?? "";
  if (!env.DB || !SAFE_WORKER_VERSION.test(workerVersionId)) {
    throw new Error("release_soak_observation_identity_unavailable");
  }
  const { durationMs, metricsJson } = validateRecordInput(input);
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const id = randomUUID();
  if (!/^[A-Fa-f0-9-]{16,64}$/u.test(id)) throw new Error("unsafe_release_soak_observation_id");

  await env.DB.prepare(`
      INSERT INTO release_scheduled_observation (
        id, schema_version, worker_version_id, cron, task_name,
        scheduled_at, started_at, completed_at, duration_ms,
        outcome, failure_category, metrics_json, created_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      workerVersionId,
      input.cron,
      input.taskName,
      new Date(input.scheduledTime).toISOString(),
      input.startedAt.toISOString(),
      input.completedAt.toISOString(),
      durationMs,
      input.outcome,
      input.failureCategory,
      metricsJson,
      input.completedAt.toISOString(),
    ).run();
}

export function observeScheduledTask<T>(
  env: AppEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  input: ReleaseScheduledObservationContext & { taskName: ReleaseScheduledTaskName },
  taskPromise: Promise<T>,
  dependencies: ObservationDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date());
  const record = dependencies.record ?? recordReleaseScheduledObservation;
  const reportDegraded =
    dependencies.reportDegraded ??
    (async (taskName: ReleaseScheduledTaskName) => {
      const { reportScheduledTaskFailure } = await import(
        "~/lib/cron-failure-alert.server"
      );
      return reportScheduledTaskFailure(
        env,
        `${taskName}_degraded`,
        new Error("scheduled task completed with a degraded outcome"),
      );
    });
  const startedAt = now();
  const observationPromise = taskPromise.then(
    async (value) => {
      const completedAt = now();
      const classification = classifyScheduledTaskResult(input.taskName, value);
      await record(env, {
        ...input,
        startedAt,
        completedAt,
        ...classification,
        failureCategory: null,
      }).catch(() => {
        (dependencies.logObservationFailure ?? ((taskName) => {
          console.error("release scheduled observation failed", { taskName });
        }))(input.taskName);
      });
      if (
        classification.outcome === "degraded" &&
        // Retention already has a dedicated failed-step page in workers/app.ts;
        // scheduled monitoring likewise has a dedicated risk page with
        // failure-mode-specific idempotency. Suppress generic duplicates.
        input.taskName !== "retention_sweep" &&
        input.taskName !== "scheduled_monitoring"
      ) {
        try {
          await reportDegraded(input.taskName);
        } catch {
          (dependencies.logDegradedReportFailure ?? ((taskName) => {
            console.error("release scheduled degraded alert failed", {
              taskName,
            });
          }))(input.taskName);
        }
      }
    },
    async (error) => {
      const completedAt = now();
      await record(env, {
        ...input,
        startedAt,
        completedAt,
        outcome: "threw",
        failureCategory: safeScheduledFailureCategory(error),
        metrics: {},
      });
    },
  ).catch(() => {
    (dependencies.logObservationFailure ?? ((taskName) => {
      console.error("release scheduled observation failed", { taskName });
    }))(input.taskName);
  });

  ctx.waitUntil(observationPromise);
  return taskPromise;
}
