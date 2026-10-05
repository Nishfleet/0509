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

/**
 * Every nightly sweep, its Sentry monitor slug and its runtime budget in
 * minutes. The sweep Workflows build their monitor from this table instead of
 * repeating the crontab string, so a cron and the monitor that watches it can
 * never drift apart (0509#7191).
 *
 * The order below is the overnight order: each sweep starts after the one
 * before it has finished, and the whole block ends before NIGHTLY_CRON. The
 * sweeps used to start at 01:00, 02:00, 02:30 and 02:45 UTC with 90 to 120
 * minute budgets, so the last three ran past 03:00 and the nightly refresh
 * (rollovers, scores, the brief) queued behind them on the same D1. At 40 to
 * 50 workspaces the site sweep alone was still running when the refresh wanted
 * to write. `tests/cadence.test.ts` asserts this table against NIGHTLY_CRON, so
 * moving a cron past the nightly reddens the gate instead of production.
 */
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

export function sweepMonitor(cron: string): SweepMonitor & { schedule: { type: "crontab"; value: string } } {
  const monitor = SWEEP_MONITORS[cron];
  if (monitor === undefined) throw new Error(`No sweep monitor for cron ${cron}`);
  return { ...monitor, schedule: { type: "crontab", value: cron } };
}

export function isDiscoveryDay(createdAt: string, now: Date): boolean {
  return new Date(createdAt).getUTCDay() === now.getUTCDay();
}
