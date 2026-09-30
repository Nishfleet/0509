import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import type { AccountDeleteParams } from "../../app/lib/account-delete.server";
import { deleteBackupPage, deleteStoredPage } from "../../app/lib/account-delete.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

async function emptyPrefix(step: WorkflowStep, prefix: string, page: number, total: number): Promise<number> {
  const result = await step.do(`delete ${prefix} page ${String(page)}`, RETRY, () => deleteStoredPage(prefix));
  const sum = total + result.deleted;
  return result.more ? emptyPrefix(step, prefix, page + 1, sum) : sum;
}

async function emptyBackupPrefix(step: WorkflowStep, prefix: string, page: number): Promise<void> {
  const result = await step.do(`delete backup ${prefix} page ${String(page)}`, RETRY, () => deleteBackupPage(prefix));
  if (result.more) await emptyBackupPrefix(step, prefix, page + 1);
}

export class AccountDelete extends WorkflowEntrypoint<Env, AccountDeleteParams> {
  async run(event: WorkflowEvent<AccountDeleteParams>, step: WorkflowStep): Promise<{ deleted: number }> {
    const deleted = await event.payload.prefixes.reduce<Promise<number>>(
      async (done, prefix) => emptyPrefix(step, prefix, 0, await done),
      Promise.resolve(0),
    );
    await event.payload.prefixes.reduce<Promise<void>>(async (done, prefix) => {
      await done;
      await emptyBackupPrefix(step, prefix, 0);
    }, Promise.resolve());
    return { deleted };
  }
}
