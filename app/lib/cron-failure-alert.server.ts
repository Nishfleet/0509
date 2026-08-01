import type { AppEnv } from "~/lib/env.server";

/** One operator alert per scheduled task per this window. */
export const CRON_FAILURE_ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;
export const CRON_FAILURE_ALERT_COUNT_MAX = 1_000_000;

export type CronFailureAlertResult = {
  sent: boolean;
  reason:
    | "sent"
    | "already_sent"
    | "throttled"
    | "retry_throttled"
    | "no_db"
    | "email_skipped"
    | "email_pending"
    | "email_failed";
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function safeTaskKey(taskKey: string) {
  const normalized = typeof taskKey === "string" ? taskKey.trim() : "";
  return /^[a-z0-9_-]{1,80}$/i.test(normalized) ? normalized : "unknown_task";
}

function safeFailureCategory(error: unknown) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "PromiseTimeoutError")) {
    return "timeout";
  }
  return error instanceof Error ? "runtime_error" : "non_error_throw";
}

function throttleWindowKey(nowMs: number) {
  return Math.floor(nowMs / CRON_FAILURE_ALERT_THROTTLE_MS);
}

/**
 * Log is the caller's job. This only decides whether to email the operator
 * and records the page attempt. Accepted pages activate the paging throttle;
 * definite rejections activate a separate retry cooldown.
 */
export async function alertScheduledTaskFailure(
  env: AppEnv,
  taskKey: string,
  error: unknown,
  options: { now?: Date } = {},
): Promise<CronFailureAlertResult> {
  if (!env.DB) {
    return { sent: false, reason: "no_db" };
  }

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const normalizedTaskKey = safeTaskKey(taskKey);
  const failureCategory = safeFailureCategory(error);
  const alertWindow = throttleWindowKey(now.getTime());
  const {
    readOperatorAlertEmailOutcome,
    sendOperatorAlertEmailDetailed,
  } = await import("~/lib/delivery.server");

  const existing = await env.DB.prepare(
    `SELECT
       last_alerted_at, last_alert_window, last_failed_at,
       last_pending_at, pending_alert_window
     FROM cron_failure_alert_throttle
     WHERE task_key = ?`,
  )
    .bind(normalizedTaskKey)
    .first<{
      last_alerted_at: string;
      last_alert_window: number | null;
      last_failed_at: string | null;
      last_pending_at: string | null;
      pending_alert_window: number | null;
    }>();

  if (existing?.last_alert_window !== null && existing?.last_alerted_at) {
    const lastMs = Date.parse(existing.last_alerted_at);
    if (
      Number.isFinite(lastMs) &&
      lastMs <= now.getTime() &&
      now.getTime() - lastMs < CRON_FAILURE_ALERT_THROTTLE_MS
    ) {
      return { sent: false, reason: "throttled" };
    }
  }

  let lastFailedAt = existing?.last_failed_at ?? null;
  const recoveryWindows = existing?.pending_alert_window === null ||
    existing?.pending_alert_window === undefined
    ? [alertWindow, alertWindow - 1]
    : [existing.pending_alert_window];
  for (const recoveryWindow of recoveryWindows) {
    const recovery = await readOperatorAlertEmailOutcome(
      env,
      `cron-failure:${normalizedTaskKey}:${recoveryWindow}`,
    );
    if (!recovery) continue;
    if (recovery.outcome === "in_flight_or_unknown") {
      await recordPendingAttempt(
        env,
        normalizedTaskKey,
        recovery.observedAt,
        recoveryWindow,
      );
      return { sent: false, reason: "email_pending" };
    }
    if (recovery.outcome === "already_accepted") {
      await recordThrottleAttempt(
        env,
        normalizedTaskKey,
        recovery.observedAt,
        recoveryWindow,
      );
      const acceptedMs = Date.parse(recovery.observedAt);
      if (
        Number.isFinite(acceptedMs) &&
        now.getTime() - acceptedMs < CRON_FAILURE_ALERT_THROTTLE_MS
      ) {
        return { sent: false, reason: "already_sent" };
      }
      continue;
    }
    await recordFailedAttempt(
      env,
      normalizedTaskKey,
      recovery.observedAt,
      recoveryWindow,
    );
    if (!lastFailedAt || recovery.observedAt > lastFailedAt) {
      lastFailedAt = recovery.observedAt;
    }
  }

  if (lastFailedAt) {
    const lastFailedMs = Date.parse(lastFailedAt);
    if (
      Number.isFinite(lastFailedMs) &&
      lastFailedMs <= now.getTime() &&
      now.getTime() - lastFailedMs < CRON_FAILURE_ALERT_THROTTLE_MS
    ) {
      return { sent: false, reason: "retry_throttled" };
    }
  }

  const idempotencyKey = `cron-failure:${normalizedTaskKey}:${alertWindow}`;
  const outcome = await sendOperatorAlertEmailDetailed(env, {
    subject: `0509 cron failure: ${normalizedTaskKey}`,
    intro: "Scheduled task failure detected:",
    lines: [
      `Scheduled task "${normalizedTaskKey}" failed.`,
      `Failure category: ${failureCategory}.`,
      "Details: Review Worker logs for the internal failure details.",
      `Time (UTC): ${nowIso}`,
      "Repeating failures for this task are throttled to one operator email per 6 hours.",
    ],
    idempotencyKey,
  });

  if (outcome === "rejected") {
    // A channel that did not accept the page has not alerted anyone. Keep the
    // failure observable and bound retries without claiming a successful page.
    await recordFailedAttempt(env, normalizedTaskKey, nowIso, alertWindow);
    return { sent: false, reason: "email_skipped" };
  }

  if (outcome === "in_flight_or_unknown") {
    await recordPendingAttempt(env, normalizedTaskKey, nowIso, alertWindow);
    return { sent: false, reason: "email_pending" };
  }

  await recordThrottleAttempt(env, normalizedTaskKey, nowIso, alertWindow);

  return outcome === "accepted"
    ? { sent: true, reason: "sent" }
    : { sent: false, reason: "already_sent" };
}

async function recordThrottleAttempt(
  env: AppEnv,
  taskKey: string,
  at: string,
  alertWindow: number,
) {
  const acceptedWindow = env.DB!.prepare(
    `INSERT OR IGNORE INTO cron_failure_alert_accepted_window (
       task_key, alert_window, accepted_at
     ) VALUES (?, ?, ?)`,
  ).bind(taskKey, alertWindow, at);
  const refreshAggregate = env.DB!.prepare(
    `INSERT INTO cron_failure_alert_throttle (
       task_key, last_alerted_at, last_error, alert_count, last_alert_window
     )
     SELECT
       ?, accepted_at, 'operator_alert_sent',
       MIN(
         COALESCE((
           SELECT accepted_count_baseline
           FROM cron_failure_alert_throttle
           WHERE task_key = ?
         ), 0) + (
           SELECT COUNT(*)
           FROM cron_failure_alert_accepted_window
           WHERE task_key = ?
         ),
         ${CRON_FAILURE_ALERT_COUNT_MAX}
       ),
       alert_window
     FROM cron_failure_alert_accepted_window
     WHERE task_key = ?
     ORDER BY alert_window DESC
     LIMIT 1
     ON CONFLICT(task_key) DO UPDATE SET
       last_alerted_at = excluded.last_alerted_at,
       last_error = excluded.last_error,
       alert_count = excluded.alert_count,
       last_alert_window = excluded.last_alert_window,
       last_pending_at = CASE
         WHEN cron_failure_alert_throttle.pending_alert_window = excluded.last_alert_window
         THEN NULL
         ELSE cron_failure_alert_throttle.last_pending_at
       END,
       pending_alert_window = CASE
         WHEN cron_failure_alert_throttle.pending_alert_window = excluded.last_alert_window
         THEN NULL
         ELSE cron_failure_alert_throttle.pending_alert_window
       END`,
  ).bind(taskKey, taskKey, taskKey, taskKey);

  await env.DB!.batch([acceptedWindow, refreshAggregate]);
}

async function recordFailedAttempt(
  env: AppEnv,
  taskKey: string,
  at: string,
  alertWindow: number,
) {
  await env.DB!.prepare(
    `INSERT INTO cron_failure_alert_throttle (
       task_key, last_alerted_at, last_error, alert_count,
       last_failed_at, failed_count
     )
     VALUES (?, ?, 'operator_alert_not_sent', 0, ?, 1)
     ON CONFLICT(task_key) DO UPDATE SET
       last_alerted_at = CASE
         WHEN cron_failure_alert_throttle.last_error = 'operator_alert_sent'
         THEN cron_failure_alert_throttle.last_alerted_at
         WHEN cron_failure_alert_throttle.last_alerted_at < excluded.last_alerted_at
         THEN excluded.last_alerted_at
         ELSE cron_failure_alert_throttle.last_alerted_at
       END,
       last_error = CASE
         WHEN cron_failure_alert_throttle.last_error = 'operator_alert_sent'
         THEN cron_failure_alert_throttle.last_error
         ELSE excluded.last_error
       END,
       alert_count = CASE
         WHEN cron_failure_alert_throttle.last_error = 'operator_alert_sent'
         THEN cron_failure_alert_throttle.alert_count
         ELSE 0
       END,
       last_failed_at = CASE
         WHEN cron_failure_alert_throttle.last_failed_at IS NULL
           OR cron_failure_alert_throttle.last_failed_at < excluded.last_failed_at
         THEN excluded.last_failed_at
         ELSE cron_failure_alert_throttle.last_failed_at
       END,
       failed_count = MIN(
         cron_failure_alert_throttle.failed_count + CASE
           WHEN cron_failure_alert_throttle.last_failed_at = excluded.last_failed_at
           THEN 0
           ELSE 1
         END,
         ${CRON_FAILURE_ALERT_COUNT_MAX}
       ),
       last_pending_at = CASE
         WHEN cron_failure_alert_throttle.pending_alert_window = ? THEN NULL
         ELSE cron_failure_alert_throttle.last_pending_at
       END,
       pending_alert_window = CASE
         WHEN cron_failure_alert_throttle.pending_alert_window = ? THEN NULL
         ELSE cron_failure_alert_throttle.pending_alert_window
       END`,
  )
    .bind(taskKey, at, at, alertWindow, alertWindow)
    .run();
}

async function recordPendingAttempt(
  env: AppEnv,
  taskKey: string,
  at: string,
  alertWindow: number,
) {
  await env.DB!.prepare(
    `INSERT INTO cron_failure_alert_throttle (
       task_key, last_alerted_at, last_error, alert_count,
       last_pending_at, pending_alert_window
     )
     VALUES (?, ?, 'operator_alert_pending', 0, ?, ?)
     ON CONFLICT(task_key) DO UPDATE SET
       last_alerted_at = CASE
         WHEN cron_failure_alert_throttle.last_alert_window IS NOT NULL
         THEN cron_failure_alert_throttle.last_alerted_at
         ELSE excluded.last_alerted_at
       END,
       last_error = CASE
         WHEN cron_failure_alert_throttle.last_alert_window IS NOT NULL
         THEN cron_failure_alert_throttle.last_error
         ELSE excluded.last_error
       END,
       alert_count = CASE
         WHEN cron_failure_alert_throttle.last_alert_window IS NOT NULL
         THEN cron_failure_alert_throttle.alert_count
         ELSE 0
       END,
       last_pending_at = CASE
         WHEN cron_failure_alert_throttle.last_pending_at IS NULL
           OR cron_failure_alert_throttle.last_pending_at < excluded.last_pending_at
         THEN excluded.last_pending_at
         ELSE cron_failure_alert_throttle.last_pending_at
       END,
       pending_alert_window = CASE
         WHEN cron_failure_alert_throttle.last_pending_at IS NULL
           OR cron_failure_alert_throttle.last_pending_at < excluded.last_pending_at
         THEN excluded.pending_alert_window
         ELSE cron_failure_alert_throttle.pending_alert_window
       END`,
  ).bind(taskKey, at, at, alertWindow).run();
}

/** Best-effort wrapper for scheduled catch blocks: never throws into the cron. */
export async function reportScheduledTaskFailure(
  env: AppEnv,
  taskKey: string,
  error: unknown,
  logContext: Record<string, unknown> = {},
) {
  console.error("scheduled task failed", {
    taskKey,
    ...logContext,
    error: errorMessage(error),
  });

  try {
    return await alertScheduledTaskFailure(env, taskKey, error);
  } catch (alertError) {
    console.error("cron failure alert itself failed", {
      taskKey,
      error: errorMessage(alertError),
    });
    return { sent: false, reason: "email_failed" as const };
  }
}
