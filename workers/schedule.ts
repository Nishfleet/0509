export const DISCOVERY_WARMUP_CRON = "17 */6 * * *";
export const DAILY_MONITORING_CRON = "0 4 * * *";
export const WEEKLY_DIGEST_CRON = "0 5 * * MON";

export type ScheduledTask =
  | {
      kind: "discovery_warmup";
    }
  | {
      kind: "monitoring";
      includeDigests: boolean;
      digestCadence?: "daily" | "weekly";
      digestLookbackDays?: number;
    };

export function resolveScheduledTask(cron: string): ScheduledTask {
  if (cron === DISCOVERY_WARMUP_CRON) {
    return { kind: "discovery_warmup" };
  }

  return {
    kind: "monitoring",
    includeDigests: cron === DAILY_MONITORING_CRON || cron === WEEKLY_DIGEST_CRON,
    digestCadence: cron === DAILY_MONITORING_CRON ? "daily" : "weekly",
    digestLookbackDays: cron === DAILY_MONITORING_CRON ? 1 : 7,
  };
}
