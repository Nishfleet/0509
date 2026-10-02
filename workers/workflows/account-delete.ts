import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import type { AccountDeleteParams } from "../../app/lib/account-delete.server";
import { deleteBackupPage, deleteStoredPage } from "../../app/lib/account-delete.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

interface Progress {
  page: number;
  total: number;
  cursor: string | null;
}

async function emptyPrefix(step: WorkflowStep, prefix: string, progress: Progress): Promise<number> {
  const { page, total, cursor } = progress;
  const result = await step.do(`delete ${prefix} page ${String(page)}`, RETRY, () => deleteStoredPage(prefix, cursor));
  const sum = total + result.deleted;
  return result.cursor === null
    ? sum
    : emptyPrefix(step, prefix, { page: page + 1, total: sum, cursor: result.cursor });
}

async function emptyBackupPrefix(step: WorkflowStep, prefix: string, progress: Progress): Promise<void> {
  const { page, cursor } = progress;
  const result = await step.do(`delete backup ${prefix} page ${String(page)}`, RETRY, () =>
    deleteBackupPage(prefix, cursor),
  );
  if (result.cursor !== null)
    await emptyBackupPrefix(step, prefix, { page: page + 1, total: 0, cursor: result.cursor });
}

export class AccountDelete extends WorkflowEntrypoint<Env, AccountDeleteParams> {
  async run(event: WorkflowEvent<AccountDeleteParams>, step: WorkflowStep): Promise<{ deleted: number }> {
    const deleted = await event.payload.prefixes.reduce<Promise<number>>(
      async (done, prefix) => emptyPrefix(step, prefix, { page: 0, total: await done, cursor: null }),
      Promise.resolve(0),
    );
    await event.payload.prefixes.reduce<Promise<void>>(async (done, prefix) => {
      await done;
      await emptyBackupPrefix(step, prefix, { page: 0, total: 0, cursor: null });
    }, Promise.resolve());
    return { deleted };
  }
}
