import type { BriefSchedule } from "../brief-schedule";
import { nextBriefAt, previousBriefAt, rolloverInstance } from "../brief-schedule";

interface RolloverLookup {
  get(id: string): Promise<{ terminate(): Promise<void> }>;
}

export function pendingRolloverIds(workspaceId: string, schedule: BriefSchedule, now: Date): string[] {
  const next = nextBriefAt(schedule, now);
  const previous = previousBriefAt(schedule, now);
  return [
    rolloverInstance(workspaceId, next, "scheduled").id,
    rolloverInstance(workspaceId, previous, "scheduled").id,
    rolloverInstance(workspaceId, previous, "catch-up").id,
  ];
}

export async function retireRollovers(
  workflow: RolloverLookup,
  workspace: { workspaceId: string; schedule: BriefSchedule },
  now: Date,
): Promise<string[]> {
  const ids = pendingRolloverIds(workspace.workspaceId, workspace.schedule, now);
  const settled = await Promise.allSettled(
    ids.map(async (id) => {
      const instance = await workflow.get(id);
      await instance.terminate();
      return id;
    }),
  );
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}
