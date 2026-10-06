export const MENTIONS_SWEEP_CRON = "0 19 * * *";
export const SITE_SWEEP_UTC_HOUR = 21;
export const SITE_SWEEP_ALLOWANCE_HOURS = 2;
export const SITE_SWEEP_CRON = `0 ${String(SITE_SWEEP_UTC_HOUR).padStart(2, "0")} * * *`;
export const SITE_SWEEP_UTC_LABEL = `${String(SITE_SWEEP_UTC_HOUR).padStart(2, "0")}:00 UTC`;
export const OWN_SITE_CHECK_CRON = "0 * * * *";
export const NIGHTLY_CRON = "0 3 * * *";
export const WEEKLY_REFRESH_CRON = "0 4 * * MON";
export const HIRING_SWEEP_CRON = "30 23 * * *";
export const FEED_SWEEP_CRON = "0 1 * * *";
export const SNAPSHOT_BACKUP_CRON = "0 5 * * *";

export interface SweepMonitor {
  slug: string;
  checkinMargin: number;
  maxRuntime: number;
}

export const SWEEP_MONITORS: Readonly<Record<string, SweepMonitor>> = {
  [MENTIONS_SWEEP_CRON]: { slug: "mentions-sweep", checkinMargin: 60, maxRuntime: 90 },
  [SITE_SWEEP_CRON]: { slug: "site-sweep", checkinMargin: 60, maxRuntime: 120 },
  [HIRING_SWEEP_CRON]: { slug: "hiring-sweep", checkinMargin: 60, maxRuntime: 90 },
  [FEED_SWEEP_CRON]: { slug: "feed-sweep", checkinMargin: 60, maxRuntime: 90 },
};

interface SweepMonitorConfig {
  schedule: { type: "crontab"; value: string };
  checkinMargin: number;
  maxRuntime: number;
}

export function sweepMonitor(cron: string): SweepMonitorConfig {
  const monitor = SWEEP_MONITORS[cron];
  if (monitor === undefined) throw new Error(`No sweep monitor for cron ${cron}`);
  return {
    schedule: { type: "crontab", value: cron },
    checkinMargin: monitor.checkinMargin,
    maxRuntime: monitor.maxRuntime,
  };
}

export function isDiscoveryDay(createdAt: string, now: Date): boolean {
  return new Date(createdAt).getUTCDay() === now.getUTCDay();
}
