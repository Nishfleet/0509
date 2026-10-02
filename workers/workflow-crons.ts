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

export function isNativeSchedule(event: { schedule?: unknown }): boolean {
  return event.schedule !== undefined;
}

export function isWorkflowCron(cron: string): cron is WorkflowCron {
  return Object.hasOwn(WORKFLOW_CRONS, cron);
}

type CronEnv = Pick<Env, (typeof WORKFLOW_CRONS)[WorkflowCron]["binding"]>;

async function startInstance(env: CronEnv, cron: WorkflowCron, scheduledTime: number) {
  const entry = WORKFLOW_CRONS[cron];
  if (!entry) throw new Error(`No workflow for cron ${cron}`);
  const { binding, name } = entry;
  const instant = new Date(scheduledTime).toISOString();
  const id = `${name}-${cron === OWN_SITE_CHECK_CRON ? instant.replace(/[:.]/g, "-") : instant.slice(0, 10)}`;
  const started = await env[binding].createBatch([{ id }]);
  return { id, created: started.length > 0 };
}

export async function startScheduledWorkflow(env: CronEnv, cron: WorkflowCron, scheduledTime: number) {
  return (await startInstance(env, cron, scheduledTime)).id;
}

function dailyCrons(): WorkflowCron[] {
  return Object.keys(WORKFLOW_CRONS).filter(
    (cron): cron is WorkflowCron => isWorkflowCron(cron) && cron !== OWN_SITE_CHECK_CRON,
  );
}

export function startMissedDailyWorkflows(env: CronEnv, now: number) {
  const dayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const due = dailyCrons().flatMap((cron) => {
    const [minute = "0", hour = "0"] = cron.split(" ");
    const scheduledTime = dayStart + (Number(hour) * 60 + Number(minute)) * 60_000;
    return scheduledTime <= now ? [{ cron, scheduledTime }] : [];
  });
  return Promise.allSettled(due.map(({ cron, scheduledTime }) => startInstance(env, cron, scheduledTime)));
}
