export const DISCOVERY_WARMUP_CRON = "17 */6 * * *";
export const REGULAR_MONITORING_CRON = "0 */3 * * *";
export const DAILY_DIGEST_CRON = "0 4 * * *";
/** @deprecated The 04:00 cron now sends daily digests only. */
export const DAILY_MONITORING_CRON = DAILY_DIGEST_CRON;
export const WEEKLY_DIGEST_CRON = "0 5 * * MON";

export type ScheduledTask =
  | {
      kind: "discovery_warmup";
    }
  | {
      kind: "monitoring";
      includeScans: boolean;
      includeDigests: boolean;
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
      digestCadence: "weekly",
      digestLookbackDays: 7,
    };
  }

  if (cron === DAILY_DIGEST_CRON) {
    return {
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      digestCadence: "daily",
      digestLookbackDays: 1,
    };
  }

  if (cron === REGULAR_MONITORING_CRON) {
    return {
      kind: "monitoring",
      includeScans: true,
      includeDigests: false,
    };
  }

  return {
    kind: "monitoring",
    includeScans: true,
    includeDigests: false,
  };
}
