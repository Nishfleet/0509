import { NIGHTLY_CRON, SNAPSHOT_BACKUP_CRON, WEEKLY_REFRESH_CRON } from "../app/lib/cadence";

const LIVENESS_CRON = "*/5 * * * *";

export interface CronMonitor {
  slug: string;
  schedule: string;
  checkinMargin: number;
  maxRuntime: number;
}

export function cronMonitor(cron: string): CronMonitor | undefined {
  if (cron === NIGHTLY_CRON) {
    return { slug: "nightly", schedule: NIGHTLY_CRON, checkinMargin: 30, maxRuntime: 30 };
  }
  if (cron === WEEKLY_REFRESH_CRON) {
    return { slug: "weekly-refresh", schedule: WEEKLY_REFRESH_CRON, checkinMargin: 60, maxRuntime: 30 };
  }
  if (cron === SNAPSHOT_BACKUP_CRON) {
    return { slug: "snapshot-backup-start", schedule: SNAPSHOT_BACKUP_CRON, checkinMargin: 60, maxRuntime: 5 };
  }
  if (cron === LIVENESS_CRON) {
    return { slug: "liveness-ping", schedule: LIVENESS_CRON, checkinMargin: 5, maxRuntime: 1 };
  }
  return undefined;
}
