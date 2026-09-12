import type { AppEnv } from "~/lib/env.server";

/**
 * Error-reporting sink (issue #2988).
 *
 * Under the standing "nothing fails silently" rule, degrade-to-honest-state
 * catches across app/ produce a rendered degraded UI but historically left no
 * durable product-side record — the only evidence was a Worker stdout log and
 * (for crons) the failure email. This sink gives every such catch a single
 * durable destination: a D1 `error_report` row (migration 0096) carrying the
 * route, a coarse reason code, the error message and a stack sample. The
 * `/api/observability/error-reports` route rolls it up into the count line the
 * hourly judges read.
 *
 * Contract:
 * - Never throws. The reporter can be called from any catch block; a broken
 *   sink must not turn one failure into two (a broken report write must not
 *   crash the loader that is already degrading).
 * - Returns a status so callers can log the outcome; it does not log by
 *   itself (log is the caller's job, same split as cron-failure-alert).
 * - Stack sampling: at most the first 3 frames, bounded to 1 KiB — enough to
 *   identify the site without paying for full traces on every catch.
 */

export const ERROR_REPORT_STACK_FRAME_MAX = 3;
export const ERROR_REPORT_STACK_SAMPLE_MAX_BYTES = 1024;
export const ERROR_REPORT_MESSAGE_MAX_BYTES = 1_024;
export const ERROR_REPORT_ROUTE_MAX = 120;
export const ERROR_REPORT_REASON_CODE_MAX = 80;

export type ErrorReportRoute = "loader" | "action" | "render" | "catch" | string;

export type ErrorReportResult = {
  written: boolean;
  reason: "written" | "no_db" | "db_error";
};

const SAFE_REASON_CODE = /^[a-z0-9._-]{1,80}$/i;

function truncateToBytes(value: string, maxBytes: number) {
  // UTF-16 truncation can over-read up to 1 byte per BMP char, so keep a tiny
  // safety margin instead of measuring code points.
  if (value.length <= maxBytes) {
    return value;
  }
  return value.slice(0, Math.max(0, maxBytes - 1)).trimEnd() + "…";
}

function errorMessage(error: unknown) {
  return truncateToBytes(
    error instanceof Error ? error.message : String(error),
    ERROR_REPORT_MESSAGE_MAX_BYTES,
  );
}

export function sampleErrorStack(error: unknown) {
  if (!(error instanceof Error) || typeof error.stack !== "string") {
    return null;
  }
  const lines = error.stack.split("\n").filter((line) => line.trim() !== "");
  // Drop the "Error: message" header line; sample the top frames only.
  const frames = (
    lines.length > 1 ? lines.slice(1, 1 + ERROR_REPORT_STACK_FRAME_MAX) : lines
  ).map((line) => line.trim());
  if (frames.length === 0) {
    return null;
  }
  return truncateToBytes(frames.join("\n"), ERROR_REPORT_STACK_SAMPLE_MAX_BYTES);
}

function safeRoute(route: string) {
  const normalized = typeof route === "string" ? route.trim() : "";
  return truncateToBytes(normalized || "unknown_route", ERROR_REPORT_ROUTE_MAX);
}

function safeReasonCode(reasonCode: string) {
  const normalized = typeof reasonCode === "string" ? reasonCode.trim() : "";
  if (!normalized || !SAFE_REASON_CODE.test(normalized)) {
    return "unknown_reason";
  }
  return truncateToBytes(normalized, ERROR_REPORT_REASON_CODE_MAX);
}

/**
 * Best-effort write of one error report. Never throws, never rejects.
 */
export async function reportError(
  env: AppEnv,
  input: { route: string; reasonCode: string; error: unknown; requestId?: string | null },
): Promise<ErrorReportResult> {
  if (!env.DB) {
    return { written: false, reason: "no_db" };
  }
  const stackSample = sampleErrorStack(input.error);
  try {
    await env.DB.prepare(
      `INSERT INTO error_report (created_at, route, reason_code, message, stack_sample, request_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        new Date().toISOString(),
        safeRoute(input.route),
        safeReasonCode(input.reasonCode),
        errorMessage(input.error),
        stackSample,
        input.requestId ?? null,
      )
      .run();
    return { written: true, reason: "written" };
  } catch {
    return { written: false, reason: "db_error" as const };
  }
}

export type ErrorReportCountRow = {
  reason_code: string;
  route: string;
  count: number;
};

export type ErrorReportRecentRow = {
  id: number;
  created_at: string;
  route: string;
  reason_code: string;
  message: string;
  request_id: string | null;
};

/**
 * Read helpers for the judge dashboard: counts by reason code over the lookback
 * window and the most recent rows. Never throws; DB problems come back as null.
 */
export async function summarizeErrorReports(env: AppEnv, lookbackMs = 24 * 60 * 60 * 1000) {
  if (!env.DB) {
    return { counts: [] as ErrorReportCountRow[], recent: [] as ErrorReportRecentRow[] };
  }
  const since = new Date(Date.now() - lookbackMs).toISOString();
  try {
    const [counts, recent] = await Promise.all([
      env.DB.prepare(
        `SELECT reason_code, route, COUNT(*) AS count
         FROM error_report
         WHERE created_at >= ?
         GROUP BY reason_code, route
         ORDER BY count DESC
         LIMIT 50`,
      )
        .bind(since)
        .all<ErrorReportCountRow>(),
      env.DB.prepare(
        `SELECT id, created_at, route, reason_code, message, request_id
         FROM error_report
         WHERE created_at >= ?
         ORDER BY id DESC
         LIMIT 25`,
      )
        .bind(since)
        .all<ErrorReportRecentRow>(),
    ]);
    return {
      counts: counts.results ?? [],
      recent: recent.results ?? [],
    };
  } catch {
    return { counts: null, recent: null };
  }
}
