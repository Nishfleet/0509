import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { copyMissingPage } from "../../app/lib/snapshot-backup.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

interface BackupTotals {
  listed: number;
  copied: number;
  present: number;
}

async function copyPages(step: WorkflowStep, page: number, cursor: string | null, totals: BackupTotals): Promise<BackupTotals> {
  const result = await step.do(`copy page ${String(page)}`, RETRY, () => copyMissingPage(cursor ?? undefined));
  const sum: BackupTotals = {
    listed: totals.listed + result.listed,
    copied: totals.copied + result.copied,
    present: totals.present + result.present,
  };
  return result.cursor === null ? sum : copyPages(step, page + 1, result.cursor, sum);
}

export class SnapshotBackup extends WorkflowEntrypoint<Env> {
  async run(_event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<BackupTotals> {
    const totals = await copyPages(step, 0, null, { listed: 0, copied: 0, present: 0 });
    console.log(JSON.stringify({ event: "snapshot.backup", ...totals }));
    return totals;
  }
}
