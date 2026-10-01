import {
  HIRING_SWEEP_CRON,
  MENTIONS_SWEEP_CRON,
  OWN_SITE_CHECK_CRON,
  SITE_SWEEP_CRON,
  SNAPSHOT_BACKUP_CRON,
} from "../app/lib/cadence";

export const WORKFLOW_CRONS = {
  [MENTIONS_SWEEP_CRON]: { binding: "MENTIONS", name: "mentions-sweep" },
  [SITE_SWEEP_CRON]: { binding: "SITE_SWEEP", name: "site-sweep" },
  [HIRING_SWEEP_CRON]: { binding: "HIRING_SWEEP", name: "hiring-sweep" },
  [SNAPSHOT_BACKUP_CRON]: { binding: "SNAPSHOT_BACKUP", name: "snapshot-backup" },
  [OWN_SITE_CHECK_CRON]: { binding: "OWN_SITE_CHECK", name: "own-site-check" },
} as const satisfies Record<string, { binding: keyof Env; name: string }>;

type WorkflowCron = Extract<keyof typeof WORKFLOW_CRONS, string>;

export function isWorkflowCron(cron: string): cron is WorkflowCron {
  return Object.hasOwn(WORKFLOW_CRONS, cron);
}

export async function startScheduledWorkflow(
  env: Pick<Env, (typeof WORKFLOW_CRONS)[WorkflowCron]["binding"]>,
  cron: WorkflowCron,
  scheduledTime: number,
): Promise<string> {
  const entry = WORKFLOW_CRONS[cron];
  if (!entry) throw new Error(`No workflow for cron ${cron}`);
  const { binding, name } = entry;
  const id = `${name}-${new Date(scheduledTime).toISOString().replace(/[:.]/g, "-")}`;
  await env[binding].createBatch([{ id }]);
  return id;
}
