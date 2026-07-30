export const DISCOVERY_WARMUP_CRON = "17 */6 * * *";
export const REGULAR_MONITORING_CRON = "0 */3 * * *";
export const DAILY_DIGEST_CRON = "0 4 * * *";
/** @deprecated The 04:00 cron now sends daily digests only. */
export const DAILY_MONITORING_CRON = DAILY_DIGEST_CRON;
export const WEEKLY_DIGEST_CRON = "0 5 * * MON";
export { SCHEDULED_OBSERVATION_HEARTBEAT_CRON } from "../app/lib/scheduled-observation-health.server";

export type ScheduledTask =
  | {
      kind: "discovery_warmup";
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
  if (input.skippedForBudget > 0 && input.dispatchFailures > 0) {
    return `operator-alert:scan-budget-and-fanout-dispatch:${dayKey}`;
  }

  if (input.skippedForBudget > 0) {
    return `operator-alert:scan-budget:${dayKey}`;
  }

  if (input.dispatchFailures > 0) {
    return `operator-alert:fanout-dispatch:${dayKey}`;
  }

  const inlineFailed = (input.inlineFailures ?? 0) > 0;
  const digestFailed = (input.digestFailures ?? 0) > 0;
  if (inlineFailed || digestFailed) {
    const failureMode =
      inlineFailed && digestFailed
        ? "inline-and-digest"
        : inlineFailed
          ? "inline"
          : "digest";
    return `operator-alert:scheduled-degraded-${failureMode}:${dayKey}`;
  }

  return null;
}
