import { bindD1Named } from "~/lib/d1-bind.server";
import type { AppEnv } from "~/lib/env.server";

export const WATCHLIST_FAILURE_ALERT_THRESHOLD = 3;
export const WATCHLIST_FAILURE_ALERT_THROTTLE_MS =
  6 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURE_ROWS = 100;

type ScheduledRunStatusRow = {
  id: string;
  status: string;
  error_code: string | null;
};

export type WatchlistFailureAlertResult = {
  sent: boolean;
  reason:
    | "sent"
    | "below_threshold"
    | "not_scheduled"
    | "throttled"
    | "no_db"
    | "email_skipped"
    | "email_failed"
    | "alert_failed";
  consecutiveFailures: number | null;
};

function safeIdentifier(value: string) {
  const normalized = value.trim();
  return /^[a-z0-9-]{1,80}$/i.test(normalized)
    ? normalized
    : "unknown";
}

function safeLabel(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 120) ||
    "Unnamed watchlist";
}

function safeErrorCode(value: string | null) {
  return value && /^[a-z0-9_-]{1,80}$/i.test(value)
    ? value
    : "unknown";
}

function throttleKey(watchlistId: string) {
  return `watchlist_failure_${watchlistId}`;
}

function throttleWindowKey(nowMs: number) {
  return Math.floor(nowMs / WATCHLIST_FAILURE_ALERT_THROTTLE_MS);
}

export async function alertConsecutiveWatchlistFailures(
  env: AppEnv,
  input: {
    watchlistId: string;
    watchlistName: string;
    runId: string;
    triggerType: "manual" | "scheduled";
    now?: Date;
  },
): Promise<WatchlistFailureAlertResult> {
  if (input.triggerType !== "scheduled") {
    return {
      sent: false,
      reason: "not_scheduled",
      consecutiveFailures: 0,
    };
  }
  if (!env.DB) {
    return {
      sent: false,
      reason: "no_db",
      consecutiveFailures: 0,
    };
  }

  const displayWatchlistId = safeIdentifier(input.watchlistId);
  const runId = safeIdentifier(input.runId);
  const runs = await bindD1Named(
    env.DB.prepare(
      `
        SELECT id, status, error_code
        FROM watchlist_run
        WHERE watchlist_id = ?
          AND trigger_type = 'scheduled'
        ORDER BY started_at DESC, id DESC
        LIMIT ?
      `,
    ),
    [
      ["watchlistFailure.watchlistId", input.watchlistId],
      ["watchlistFailure.rowLimit", MAX_CONSECUTIVE_FAILURE_ROWS],
    ],
  ).all<ScheduledRunStatusRow>();
  const orderedRuns = runs.results ?? [];
  let consecutiveFailures = 0;
  for (const run of orderedRuns) {
    if (run.status !== "failed") {
      break;
    }
    consecutiveFailures += 1;
  }

  if (consecutiveFailures < WATCHLIST_FAILURE_ALERT_THRESHOLD) {
    return {
      sent: false,
      reason: "below_threshold",
      consecutiveFailures,
    };
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const taskKey = throttleKey(input.watchlistId);
  const existing = await bindD1Named(
    env.DB.prepare(
      `SELECT last_alerted_at
       FROM cron_failure_alert_throttle
       WHERE task_key = ?`,
    ),
    [["watchlistFailure.taskKey", taskKey]],
  ).first<{ last_alerted_at: string }>();
  if (existing?.last_alerted_at) {
    const lastAlertedAt = Date.parse(existing.last_alerted_at);
    if (
      Number.isFinite(lastAlertedAt) &&
      now.getTime() - lastAlertedAt <
        WATCHLIST_FAILURE_ALERT_THROTTLE_MS
    ) {
      return {
        sent: false,
        reason: "throttled",
        consecutiveFailures,
      };
    }
  }

  const latestFailure = orderedRuns[0] ?? null;
  const { sendOperatorAlertEmail } = await import("~/lib/delivery.server");
  let sent: boolean;
  try {
    sent = await sendOperatorAlertEmail(env, {
      subject: `0509 watchlist monitoring failure: ${safeLabel(input.watchlistName)}`,
      intro: "A watchlist monitoring promise needs attention:",
      lines: [
        `Watchlist "${safeLabel(input.watchlistName)}" (${displayWatchlistId}) has failed ${consecutiveFailures} consecutive scheduled runs.`,
        `Latest run: ${runId}.`,
        `Failure code: ${safeErrorCode(latestFailure?.error_code ?? null)}.`,
        `Time (UTC): ${nowIso}`,
        "The next scheduled scan will retry automatically. Review Worker logs and watchlist run history.",
        "Repeating alerts for this watchlist are throttled to one per 6 hours.",
      ],
      idempotencyKey:
        `watchlist-failure:${input.watchlistId}:${throttleWindowKey(now.getTime())}`,
    });
  } catch {
    return {
      sent: false,
      reason: "email_failed",
      consecutiveFailures,
    };
  }

  if (sent) {
    await recordThrottleAttempt(
      env,
      taskKey,
      nowIso,
      "operator_alert_sent",
    );
  }
  return {
    sent,
    reason: sent ? "sent" : "email_skipped",
    consecutiveFailures,
  };
}

async function recordThrottleAttempt(
  env: AppEnv,
  taskKey: string,
  at: string,
  detail: string,
) {
  await bindD1Named(
    env.DB!.prepare(
      `
        INSERT INTO cron_failure_alert_throttle (
          task_key,
          last_alerted_at,
          last_error,
          alert_count
        )
        VALUES (?, ?, ?, 1)
        ON CONFLICT(task_key) DO UPDATE SET
          last_alerted_at = excluded.last_alerted_at,
          last_error = excluded.last_error,
          alert_count = cron_failure_alert_throttle.alert_count + 1
      `,
    ),
    [
      ["watchlistFailure.taskKey", taskKey],
      ["watchlistFailure.alertedAt", at],
      ["watchlistFailure.result", detail],
    ],
  ).run();
}

/** Never let observability failure change the customer run's terminal state. */
export async function reportConsecutiveWatchlistFailure(
  env: AppEnv,
  input: {
    watchlistId: string;
    watchlistName: string;
    runId: string;
    triggerType: "manual" | "scheduled";
  },
) {
  try {
    const result = await alertConsecutiveWatchlistFailures(env, input);
    if (
      result.reason === "email_failed" ||
      result.reason === "email_skipped"
    ) {
      console.error("watchlist failure operator alert was not sent", {
        watchlistId: safeIdentifier(input.watchlistId),
        runId: safeIdentifier(input.runId),
        reason: result.reason,
        consecutiveFailures: result.consecutiveFailures,
      });
    }
    return result;
  } catch (error) {
    console.error("watchlist failure alert itself failed", {
      watchlistId: safeIdentifier(input.watchlistId),
      runId: safeIdentifier(input.runId),
      error:
        error instanceof Error
          ? error.message
          : "Unknown watchlist alert failure.",
    });
    return {
      sent: false,
      reason: "alert_failed" as const,
      consecutiveFailures: null,
    };
  }
}
