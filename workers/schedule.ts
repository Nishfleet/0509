export const DISCOVERY_WARMUP_CRON = "17 */6 * * *";
/**
 * Cron for the dedicated public /ads/:domain refresh — re-issued separately
 * from the watchlist-based `discovery_warmup` because brand pages whose
 * domain nobody watches never get re-warmed by the watchlist path. The
 * implementation lives in `app/lib/brand-page-refresh.server`; the cron
 * string is duplicated here so `resolveScheduledTask` can dispatch it
 * without an extra import boundary.
 */
export const BRAND_PAGE_REFRESH_CRON = "37 */12 * * *";
export const REGULAR_MONITORING_CRON = "0 */3 * * *";
export const DAILY_DIGEST_CRON = "0 4 * * *";
/** @deprecated The 04:00 cron now sends daily digests only. */
export const DAILY_MONITORING_CRON = DAILY_DIGEST_CRON;
export const WEEKLY_DIGEST_CRON = "0 5 * * MON";
export { SCHEDULED_OBSERVATION_GAP_CHECK_CRON } from "../app/lib/scheduled-observation-health.server";

export type ScheduledTask =
  | {
      kind: "discovery_warmup";
    }
  | {
      kind: "brand_page_refresh";
    }
  | {
      kind: "monitoring";
      includeScans: boolean;
      includeDigests: boolean;
      includeRiskAlert: boolean;
      digestCadence?: "daily" | "weekly";
      digestLookbackDays?: number;
    };

export function resolveScheduledTask(cron: string): ScheduledTask {
  if (cron === DISCOVERY_WARMUP_CRON) {
    return { kind: "discovery_warmup" };
  }

  if (cron === BRAND_PAGE_REFRESH_CRON) {
    return { kind: "brand_page_refresh" };
  }

  if (cron === WEEKLY_DIGEST_CRON) {
    // The Monday 05:00 cron only assembles the weekly digests. Regular scans
    // run on the three-hour cron, so this path must not double-scan.
    return {
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      includeRiskAlert: false,
      digestCadence: "weekly",
      digestLookbackDays: 7,
    };
  }

  if (cron === DAILY_DIGEST_CRON) {
    return {
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      includeRiskAlert: true,
      digestCadence: "daily",
      digestLookbackDays: 1,
    };
  }

  if (cron === REGULAR_MONITORING_CRON) {
    return {
      kind: "monitoring",
      includeScans: true,
      includeDigests: false,
      includeRiskAlert: false,
    };
  }

  return {
    kind: "monitoring",
    includeScans: true,
    includeDigests: false,
    includeRiskAlert: false,
  };
}

export function resolveOperationalRiskAlertIdempotencyKey(
  dayKey: string,
  input: {
    skippedForBudget: number;
    dispatchFailures: number;
    inlineFailures?: number;
    digestFailures?: number;
  },
) {
  const budgetSkipped = input.skippedForBudget > 0;
  const dispatchFailed = input.dispatchFailures > 0;
  const inlineFailed = (input.inlineFailures ?? 0) > 0;
  const digestFailed = (input.digestFailures ?? 0) > 0;

  if (budgetSkipped && dispatchFailed && !inlineFailed && !digestFailed) {
    return `operator-alert:scan-budget-and-fanout-dispatch:${dayKey}`;
  }

  if (budgetSkipped && !dispatchFailed && !inlineFailed && !digestFailed) {
    return `operator-alert:scan-budget:${dayKey}`;
  }

  if (dispatchFailed && !budgetSkipped && !inlineFailed && !digestFailed) {
    return `operator-alert:fanout-dispatch:${dayKey}`;
  }

  if (!budgetSkipped && !dispatchFailed && (inlineFailed || digestFailed)) {
    const failureMode =
      inlineFailed && digestFailed
        ? "inline-and-digest"
        : inlineFailed
          ? "inline"
          : "digest";
    return `operator-alert:scheduled-degraded-${failureMode}:${dayKey}`;
  }

  const failureModes = [
    budgetSkipped ? "scan-budget" : null,
    dispatchFailed ? "fanout-dispatch" : null,
    inlineFailed ? "inline" : null,
    digestFailed ? "digest" : null,
  ].filter((mode): mode is string => mode !== null);

  return failureModes.length > 0
    ? `operator-alert:scheduled-degraded-${failureModes.join("-and-")}:${dayKey}`
    : null;
}
