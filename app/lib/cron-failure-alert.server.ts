import type { AppEnv } from "~/lib/env.server";

/** One operator alert per scheduled task per this window. */
export const CRON_FAILURE_ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;
export const CRON_FAILURE_ALERT_COUNT_MAX = 1_000_000;

export type CronFailureAlertResult = {
  sent: boolean;
  reason: "sent" | "throttled" | "no_db" | "email_skipped" | "email_failed";
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
 * and records the page attempt. Only an accepted page activates the throttle.
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

  const existing = await env.DB.prepare(
    `SELECT last_alerted_at
     FROM cron_failure_alert_throttle
     WHERE task_key = ? AND last_error = 'operator_alert_sent'`,
  )
    .bind(normalizedTaskKey)
    .first<{ last_alerted_at: string }>();

  if (existing?.last_alerted_at) {
    const lastMs = Date.parse(existing.last_alerted_at);
    if (Number.isFinite(lastMs) && now.getTime() - lastMs < CRON_FAILURE_ALERT_THROTTLE_MS) {
      return { sent: false, reason: "throttled" };
    }
  }

  const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
  const idempotencyKey = `cron-failure:${normalizedTaskKey}:${throttleWindowKey(now.getTime())}`;
  const sent = await sendOperatorAlertEmail(env, {
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

  if (!sent) {
    // A channel that did not accept the page has not alerted anyone. Do not
    // activate the successful-alert throttle: the next failure must retry.
    // Keep one durable failed-page fact so the channel outage stays observable.
    await recordFailedAttempt(env, normalizedTaskKey, nowIso);
    return { sent: false, reason: "email_skipped" };
  }

  await recordThrottleAttempt(env, normalizedTaskKey, nowIso, "operator_alert_sent");

  return { sent: true, reason: "sent" };
}

async function recordThrottleAttempt(env: AppEnv, taskKey: string, at: string, detail: string) {
  await env.DB!.prepare(
    `INSERT INTO cron_failure_alert_throttle (task_key, last_alerted_at, last_error, alert_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(task_key) DO UPDATE SET
       last_alerted_at = excluded.last_alerted_at,
       last_error = excluded.last_error,
       alert_count = cron_failure_alert_throttle.alert_count + 1`,
  )
    .bind(taskKey, at, detail)
    .run();
}

async function recordFailedAttempt(env: AppEnv, taskKey: string, at: string) {
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
         ELSE excluded.last_alerted_at
       END,
       last_error = CASE
         WHEN cron_failure_alert_throttle.last_error = 'operator_alert_sent'
         THEN cron_failure_alert_throttle.last_error
         ELSE excluded.last_error
       END,
       last_failed_at = excluded.last_failed_at,
       failed_count = MIN(
         cron_failure_alert_throttle.failed_count + 1,
         ${CRON_FAILURE_ALERT_COUNT_MAX}
       )`,
  )
    .bind(taskKey, at, at)
    .run();
}

/** Best-effort wrapper for scheduled catch blocks: never throws into the cron. */
export async function reportScheduledTaskFailure(
  env: AppEnv,
  taskKey: string,
  error: unknown,
  logContext: Record<string, unknown> = {},
) {
  console.error(`${taskKey} failed`, {
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
