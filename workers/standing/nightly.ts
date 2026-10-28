import { rolloverInstance, type RolloverInstance } from "../../app/lib/brief-schedule";
import { runPipelineHealth } from "../../app/lib/observability/pipeline-health.server";
import { createRollovers, loadNightlyPlan } from "./rollover-plan";

export function nightlyCatchUpInstance(workspaceId: string, closesAt: Date, night: Date): RolloverInstance {
  const base = rolloverInstance(workspaceId, closesAt, "catch-up");
  return { ...base, id: `${base.id}-${night.toISOString().slice(0, 10).replace(/-/g, "")}` };
}

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
  const catchUps = catchUpAt.map((row) => nightlyCatchUpInstance(row.workspaceId, row.closesAt, now));
  const rolloversCreated = await createRollovers(env.STANDING_ROLLOVER, [...scheduled, ...catchUps]);
  const result: NightlyResult = {
    workspaces,
    rolloversCreated,
    catchUps: catchUps.length,
  };
  console.log(JSON.stringify({ event: "standing.nightly", ...result }));
  return result;
}
