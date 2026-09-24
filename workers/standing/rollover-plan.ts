import { z } from "zod";

import type { BriefSchedule } from "../../app/lib/brief-schedule";
import { instantStamp } from "../../app/lib/brief-schedule";

export interface RolloverParams {
  workspaceId: string;
  closesAt: string;
}

export interface RolloverInstance {
  id: string;
  params: RolloverParams;
}

export interface WorkspaceSchedule {
  workspaceId: string;
  schedule: BriefSchedule;
}

const WORKSPACE_SCHEDULES = `SELECT id, timezone, brief_weekday, brief_hour FROM workspace ORDER BY id`;

const WORKSPACE_SCHEDULE = `SELECT id, timezone, brief_weekday, brief_hour FROM workspace WHERE id = ?1`;

const scheduleRows = z.array(
  z.object({
    id: z.string(),
    timezone: z.string(),
    brief_weekday: z.number().int(),
    brief_hour: z.number().int(),
  }),
);

const CREATE_BATCH_LIMIT = 100;

function toSchedules(rows: readonly unknown[]): readonly WorkspaceSchedule[] {
  return scheduleRows.parse(rows).map((row) => ({
    workspaceId: row.id,
    schedule: { timezone: row.timezone, weekday: row.brief_weekday, hour: row.brief_hour },
  }));
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

export function rolloverInstance(
  workspaceId: string,
  closesAt: Date,
  kind: "scheduled" | "catch-up",
): RolloverInstance {
  const suffix = kind === "catch-up" ? "-catch-up" : "";
  return {
    id: `rollover-${workspaceId}-${instantStamp(closesAt)}${suffix}`,
    params: { workspaceId, closesAt: closesAt.toISOString() },
  };
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
