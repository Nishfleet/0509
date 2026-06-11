export const DISCOVERY_WARMUP_CRON = "17 */6 * * *";
export const DAILY_MONITORING_CRON = "0 4 * * *";
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
    // The Monday 05:00 cron fires one hour after the daily 04:00 scan, which
    // already covers every watchlist (including scout on Mondays). Re-scanning
    // here would double Browser Rendering cost and burn each watchlist's daily
    // proof budget twice, so this run only assembles the weekly digests.
    return {
      kind: "monitoring",
      includeScans: false,
      includeDigests: true,
      digestCadence: "weekly",
      digestLookbackDays: 7,
    };
  }

  return {
    kind: "monitoring",
    includeScans: true,
    includeDigests: cron === DAILY_MONITORING_CRON,
    digestCadence: cron === DAILY_MONITORING_CRON ? "daily" : "weekly",
    digestLookbackDays: cron === DAILY_MONITORING_CRON ? 1 : 7,
  };
}
