export const DISCOVERY_WARMUP_CRON = "17 */6 * * *";
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
      kind: "monitoring";
      includeScans: boolean;
      includeDigests: boolean;
      includeMentionResweep: boolean;
      includeAutoCompetitorResweep: boolean;
      includeRiskAlert: boolean;
      digestCadence?: "daily" | "weekly";
      digestLookbackDays?: number;
    };

export function resolveScheduledTask(cron: string): ScheduledTask {
  if (cron === DISCOVERY_WARMUP_CRON) {
    return { kind: "discovery_warmup" };
  }

  if (cron === WEEKLY_DIGEST_CRON) {
    // The Monday 05:00 cron only assembles the weekly digests. Regular scans
    // run on the three-hour cron, so this path must not double-scan.
    return {
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      includeMentionResweep: false,
      includeAutoCompetitorResweep: false,
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
      includeMentionResweep: false,
      includeAutoCompetitorResweep: true,
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
      includeMentionResweep: true,
      includeAutoCompetitorResweep: false,
      includeRiskAlert: false,
    };
  }

  return {
    kind: "monitoring",
    includeScans: true,
    includeDigests: false,
    includeMentionResweep: true,
    includeAutoCompetitorResweep: false,
    includeRiskAlert: false,
  };
}

/**
 * Scan-failure-rate alert (fleet-ops 0509 reccos): in fanout mode scans fail
 * *inside* Workflows after dispatch, so `skippedForBudget` / `dispatchFailures`
 * / `inlineFailures` / `digestFailures` never reflect them. The operator is
 * paged when the at-risk (failed + retrying) share of the scanned
 * `watchlist_run` population over the trailing orchestration window stays above
 * this threshold with at least `SCAN_FAILURE_MIN_FINISHED_RUNS` scanned runs —
 * exactly one email per idempotency day, keyed below.
 */
export const SCAN_FAILURE_RATE_THRESHOLD = 0.25;
export const SCAN_FAILURE_MIN_FINISHED_RUNS = 8;

/**
 * A scheduled scan counts as at-risk when it either hard-failed inside the
 * Workflow (`scanFailed`) or is stuck retrying a dispatch error (`scanRetrying`).
 * The operator page fires when the at-risk share of the scanned population
 * (`at-risk + succeeded`) stays above the threshold with enough runs.
 */
export function isScanFailureRateExceeded(
  scanFailed: number,
  scanRetrying: number,
  scanSucceeded: number,
): boolean {
  const atRisk = Math.max(0, scanFailed) + Math.max(0, scanRetrying);
  const scanned = atRisk + Math.max(0, scanSucceeded);
  return (
    scanned >= SCAN_FAILURE_MIN_FINISHED_RUNS &&
    atRisk / scanned >= SCAN_FAILURE_RATE_THRESHOLD
  );
}

export function resolveOperationalRiskAlertIdempotencyKey(
  dayKey: string,
  input: {
    skippedForBudget: number;
    dispatchFailures: number;
    inlineFailures?: number;
    digestFailures?: number;
    scanFailed?: number;
    scanRetrying?: number;
    scanSucceeded?: number;
  },
) {
  if (
    isScanFailureRateExceeded(
      input.scanFailed ?? 0,
      input.scanRetrying ?? 0,
      input.scanSucceeded ?? 0,
    )
  ) {
    return `operator-alert:scan-failure-rate:${dayKey}`;
  }
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
