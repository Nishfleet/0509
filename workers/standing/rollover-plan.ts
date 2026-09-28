import { z } from "zod";

import type { BriefSchedule, RolloverInstance, RolloverParams } from "../../app/lib/brief-schedule";
import { openWeek, previousBriefAt, rolloverInstance } from "../../app/lib/brief-schedule";

export interface WorkspaceSchedule {
  workspaceId: string;
  schedule: BriefSchedule;
  briefPausedAt: string | null;
}

export const CATCH_UP_GRACE_MS = 60 * 60 * 1000;
export const UNRANKED_LOOKBACK_MS = 16 * 24 * 60 * 60 * 1000;

const WORKSPACE_SCHEDULES = `SELECT DISTINCT w.id, w.timezone, w.brief_weekday, w.brief_hour, w.brief_paused_at
FROM entity e
INNER JOIN workspace w ON w.id = e.workspace_id
WHERE e.role = 'self' AND e.state = 'on'
ORDER BY w.id`;

const WORKSPACE_SCHEDULE = `SELECT id, timezone, brief_weekday, brief_hour, brief_paused_at FROM workspace WHERE id = ?1`;

const UNRANKED_WEEKS = `SELECT s.workspace_id AS workspace_id, s.week_start_at AS week_start_at
FROM standing s
INNER JOIN entity e ON e.workspace_id = s.workspace_id AND e.role = 'self' AND e.state = 'on'
WHERE s.week_start_at >= ?1
GROUP BY s.workspace_id, s.week_start_at
HAVING COUNT(s.rank) = 0`;

const scheduleRows = z.array(
  z.object({
    id: z.string(),
    timezone: z.string(),
    brief_weekday: z.number().int(),
    brief_hour: z.number().int(),
    brief_paused_at: z.string().nullable(),
  }),
);

const unrankedRows = z.array(
  z.object({
    workspace_id: z.string(),
    week_start_at: z.string(),
  }),
);

const CREATE_BATCH_LIMIT = 100;

function toSchedules(rows: readonly unknown[]): readonly WorkspaceSchedule[] {
  return scheduleRows.parse(rows).map((row) => ({
    workspaceId: row.id,
    schedule: { timezone: row.timezone, weekday: row.brief_weekday, hour: row.brief_hour },
    briefPausedAt: row.brief_paused_at,
  }));
}

export function unrankedWeekKey(workspaceId: string, weekStartAt: string): string {
  return `${workspaceId}\t${weekStartAt}`;
}

export async function readWorkspaceSchedules(db: D1Database): Promise<readonly WorkspaceSchedule[]> {
  const rows = await db.prepare(WORKSPACE_SCHEDULES).all();
  return toSchedules(rows.results);
}

export async function readWorkspaceSchedule(
  db: D1Database,
  workspaceId: string,
): Promise<WorkspaceSchedule | null> {
  const rows = await db.prepare(WORKSPACE_SCHEDULE).bind(workspaceId).all();
  return toSchedules(rows.results)[0] ?? null;
}

export async function readUnrankedWeeks(db: D1Database, now: Date): Promise<ReadonlySet<string>> {
  const since = new Date(now.getTime() - UNRANKED_LOOKBACK_MS).toISOString();
  const rows = await db.prepare(UNRANKED_WEEKS).bind(since).all();
  return new Set(
    unrankedRows.parse(rows.results).map((row) => unrankedWeekKey(row.workspace_id, row.week_start_at)),
  );
}

export interface CatchUp {
  workspaceId: string;
  closesAt: Date;
}

export async function loadNightlyPlan(
  db: D1Database,
  now: Date,
): Promise<{ workspaces: number; scheduled: RolloverInstance[]; catchUpAt: CatchUp[] }> {
  const [workspaces, unranked] = await Promise.all([readWorkspaceSchedules(db), readUnrankedWeeks(db, now)]);
  const { scheduled, catchUpAt } = planRollovers(workspaces, unranked, now);
  return { workspaces: workspaces.length, scheduled, catchUpAt };
}

export function planRollovers(
  workspaces: readonly WorkspaceSchedule[],
  unrankedWeekStarts: ReadonlySet<string>,
  now: Date,
): { scheduled: RolloverInstance[]; catchUpAt: CatchUp[] } {
  const scheduled: RolloverInstance[] = [];
  const catchUpAt: { workspaceId: string; closesAt: Date }[] = [];
  for (const workspace of workspaces) {
    const week = openWeek(workspace.schedule, now);
    scheduled.push(rolloverInstance(workspace.workspaceId, week.closesAt, "scheduled"));
    const lastClose = week.startsAt;
    const closedWeekStart = previousBriefAt(workspace.schedule, lastClose).toISOString();
    if (
      unrankedWeekStarts.has(unrankedWeekKey(workspace.workspaceId, closedWeekStart)) &&
      now.getTime() - lastClose.getTime() > CATCH_UP_GRACE_MS
    ) {
      catchUpAt.push({ workspaceId: workspace.workspaceId, closesAt: lastClose });
    }
  }
  return { scheduled, catchUpAt };
}

export async function createRollovers(
  workflow: Workflow<RolloverParams>,
  instances: readonly RolloverInstance[],
): Promise<number> {
  const chunks = Array.from(
    { length: Math.ceil(instances.length / CREATE_BATCH_LIMIT) },
    (_, index) => instances.slice(index * CREATE_BATCH_LIMIT, (index + 1) * CREATE_BATCH_LIMIT),
  );
  const created = await Promise.all(chunks.map((chunk) => workflow.createBatch([...chunk])));
  return created.reduce((total, batch) => total + batch.length, 0);
}
