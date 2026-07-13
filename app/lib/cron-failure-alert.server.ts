import type { AppEnv } from "~/lib/env.server";

/** One operator alert per scheduled task per this window. */
export const CRON_FAILURE_ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000;

export type CronFailureAlertResult = {
  sent: boolean;
  reason: "sent" | "throttled" | "no_db" | "email_skipped" | "email_failed";
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function throttleWindowKey(nowMs: number) {
  return Math.floor(nowMs / CRON_FAILURE_ALERT_THROTTLE_MS);
}

/**
 * Log is the caller's job. This only decides whether to email the operator
 * and records the throttle row when a send is attempted/accepted.
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
  const message = errorMessage(error).slice(0, 500);

  const existing = await env.DB.prepare(
    `SELECT last_alerted_at FROM cron_failure_alert_throttle WHERE task_key = ?`,
  )
    .bind(taskKey)
    .first<{ last_alerted_at: string }>();

  if (existing?.last_alerted_at) {
    const lastMs = Date.parse(existing.last_alerted_at);
    if (Number.isFinite(lastMs) && now.getTime() - lastMs < CRON_FAILURE_ALERT_THROTTLE_MS) {
      return { sent: false, reason: "throttled" };
    }
  }

  const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
  const idempotencyKey = `cron-failure:${taskKey}:${throttleWindowKey(now.getTime())}`;
  const sent = await sendOperatorAlertEmail(env, {
    subject: `0509 cron failure: ${taskKey}`,
    lines: [
      `Scheduled task "${taskKey}" failed.`,
      `Error: ${message}`,
      `Time (UTC): ${nowIso}`,
      "Repeating failures for this task are throttled to one operator email per 6 hours.",
    ],
    idempotencyKey,
  });

  if (!sent) {
    return { sent: false, reason: "email_skipped" };
  }

  await env.DB.prepare(
    `INSERT INTO cron_failure_alert_throttle (task_key, last_alerted_at, last_error, alert_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(task_key) DO UPDATE SET
       last_alerted_at = excluded.last_alerted_at,
       last_error = excluded.last_error,
       alert_count = cron_failure_alert_throttle.alert_count + 1`,
  )
    .bind(taskKey, nowIso, message)
    .run();

  return { sent: true, reason: "sent" };
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
