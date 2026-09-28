import { rolloverInstance } from "../../app/lib/brief-schedule";
import { runPipelineHealth } from "../../app/lib/observability/pipeline-health.server";
import { createRollovers, loadNightlyPlan } from "./rollover-plan";

export interface NightlyResult {
  workspaces: number;
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
  const { workspaces, scheduled, catchUpAt } = await loadNightlyPlan(env.DB, now);
  const catchUps = catchUpAt.map((row) => rolloverInstance(row.workspaceId, row.closesAt, "catch-up"));
  const rolloversCreated = await createRollovers(env.STANDING_ROLLOVER, [...scheduled, ...catchUps]);
  const result: NightlyResult = {
    workspaces,
    rolloversCreated,
    catchUps: catchUps.length,
  };
  console.log(JSON.stringify({ event: "standing.nightly", ...result }));
  return result;
}
