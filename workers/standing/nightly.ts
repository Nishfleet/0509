import { z } from "zod";

import { openWeek, previousBriefAt, rolloverInstance } from "../../app/lib/brief-schedule";
import { runPipelineHealth } from "../../app/lib/observability/pipeline-health.server";
import { refreshWorkspaceScores } from "./refresh";
import type { WorkspaceSchedule } from "./rollover-plan";
import { createRollovers, readWorkspaceSchedules } from "./rollover-plan";

export interface NightlyResult {
  workspaces: number;
  refreshed: number;
  failed: number;
  rolloversCreated: number;
  catchUps: number;
}

const CATCH_UP_GRACE_MS = 60 * 60 * 1000;

const CLOSED_WEEK_STATE = `SELECT COUNT(*) AS total, COUNT(rank) AS ranked
FROM standing
WHERE workspace_id = ?1 AND week_start_at = ?2`;

const closedWeekRows = z.array(z.object({ total: z.number().int(), ranked: z.number().int() }));

interface WorkspacePlan {
  workspaceId: string;
  closesAt: Date;
  missedCloseAt: Date | null;
}

async function planWorkspace(
  db: D1Database,
  { workspaceId, schedule }: WorkspaceSchedule,
  now: Date,
): Promise<WorkspacePlan> {
  const week = openWeek(schedule, now);
  const startsAt = week.startsAt.toISOString();
  await refreshWorkspaceScores(db, {
    workspaceId,
    weekStartAt: startsAt,
    windowStartAt: startsAt,
    windowEndAt: week.closesAt.toISOString(),
    computedAt: now.toISOString(),
  });

  const lastClose = week.startsAt;
  const closedWeekStart = previousBriefAt(schedule, lastClose).toISOString();
  const state = await db.prepare(CLOSED_WEEK_STATE).bind(workspaceId, closedWeekStart).all();
  const [closed] = closedWeekRows.parse(state.results);
  const isMissed =
    closed !== undefined &&
    closed.total > 0 &&
    closed.ranked === 0 &&
    now.getTime() - lastClose.getTime() > CATCH_UP_GRACE_MS;

  return { workspaceId, closesAt: week.closesAt, missedCloseAt: isMissed ? lastClose : null };
}

export async function runNightlyStanding(env: Env, now: Date): Promise<NightlyResult> {
  const [health] = await Promise.allSettled([runPipelineHealth(now)]);
  console.log(
    JSON.stringify({
      event: "pipeline.health",
      ...(health.status === "fulfilled" ? health.value : { error: String(health.reason) }),
    }),
  );
  const workspaces = await readWorkspaceSchedules(env.DB);
  const settled = await workspaces.reduce<Promise<readonly PromiseSettledResult<WorkspacePlan>[]>>(
    async (done, workspace) => {
      const previous = await done;
      const [result] = await Promise.allSettled([planWorkspace(env.DB, workspace, now)]);
      return [...previous, result];
    },
    Promise.resolve([]),
  );

  const plans = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failures = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ workspaceId: workspaces[index]?.workspaceId, reason: String(result.reason) }]
      : [],
  );

  const scheduled = plans.map((plan) => rolloverInstance(plan.workspaceId, plan.closesAt, "scheduled"));
  const catchUps = plans.flatMap((plan) =>
    plan.missedCloseAt === null ? [] : [rolloverInstance(plan.workspaceId, plan.missedCloseAt, "catch-up")],
  );
  const rolloversCreated = await createRollovers(env.STANDING_ROLLOVER, [...scheduled, ...catchUps]);

  const result: NightlyResult = {
    workspaces: workspaces.length,
    refreshed: plans.length,
    failed: failures.length,
    rolloversCreated,
    catchUps: catchUps.length,
  };
  console.log(JSON.stringify({ event: "standing.nightly", ...result }));
  if (failures.length > 0) {
    console.error(JSON.stringify({ event: "standing.nightly.failed", failures }));
    throw new Error(`standing nightly failed for ${String(failures.length)} of ${String(workspaces.length)} workspaces`);
  }
  return result;
}
