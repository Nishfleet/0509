import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { readFixtureWatchIds } from "../../app/lib/data/watch.server";
import { copyMissingPage } from "../../app/lib/snapshot-backup.server";
import { isNativeSchedule } from "../workflow-crons";
import { withStepCheckIn } from "../workflow-monitor";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

const MONITOR = {
  schedule: { type: "crontab", value: "0 5 * * *" },
  checkinMargin: 60,
  maxRuntime: 60,
  timezone: "UTC",
} as const;

interface BackupTotals {
  listed: number;
  copied: number;
  present: number;
  skipped: number;
}

interface BackupPosition {
  page: number;
  cursor: string | null;
  fixtureWatchIds: readonly string[];
}

async function copyPages(step: WorkflowStep, position: BackupPosition, totals: BackupTotals): Promise<BackupTotals> {
  const { page, cursor, fixtureWatchIds } = position;
  const result = await step.do(`copy page ${String(page)}`, RETRY, () =>
    copyMissingPage(cursor ?? undefined, fixtureWatchIds),
  );
  const sum: BackupTotals = {
    listed: totals.listed + result.listed,
    copied: totals.copied + result.copied,
    present: totals.present + result.present,
    skipped: totals.skipped + result.skipped,
  };
  return result.cursor === null ? sum : copyPages(step, { ...position, page: page + 1, cursor: result.cursor }, sum);
}

export class SnapshotBackup extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<BackupTotals | null> {
    if (isNativeSchedule(event)) return null;
    return withStepCheckIn(step, { slug: "snapshot-backup", config: MONITOR }, async () => {
      const fixtureWatchIds = await step.do("read fixture watches", RETRY, readFixtureWatchIds);
      const totals = await copyPages(
        step,
        { page: 0, cursor: null, fixtureWatchIds },
        { listed: 0, copied: 0, present: 0, skipped: 0 },
      );
      console.log(JSON.stringify({ event: "snapshot.backup", ...totals }));
      return totals;
    });
  }
}
