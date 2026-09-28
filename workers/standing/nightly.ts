import { runPipelineHealth } from "../../app/lib/observability/pipeline-health.server";
import { createRollovers, planRollovers, readUnrankedWeeks, readWorkspaceSchedules } from "./rollover-plan";

export interface NightlyResult {
  workspaces: number;
  refreshed: number;
  failed: number;
  rolloversCreated: number;
  catchUps: number;
}

export async function runNightlyStanding(env: Env, now: Date): Promise<NightlyResult> {
  const [health] = await Promise.allSettled([runPipelineHealth(now)]);
  console.log(
    JSON.stringify({
      event: "pipeline.health",
      ...(health.status === "fulfilled" ? health.value : { error: String(health.reason) }),
    }),
  );
  const [workspaces, unranked] = await Promise.all([readWorkspaceSchedules(env.DB), readUnrankedWeeks(env.DB)]);
  const { scheduled, catchUps } = planRollovers(workspaces, unranked, now);
  const rolloversCreated = await createRollovers(env.STANDING_ROLLOVER, [...scheduled, ...catchUps]);
  const result: NightlyResult = {
    workspaces: workspaces.length,
    refreshed: 0,
    failed: 0,
    rolloversCreated,
    catchUps: catchUps.length,
  };
  console.log(JSON.stringify({ event: "standing.nightly", ...result }));
  return result;
}
