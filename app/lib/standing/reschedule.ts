import type { BriefSchedule, RolloverInstance } from "../brief-schedule";
import { nextBriefAt, rolloverInstance } from "../brief-schedule";

interface RolloverWorkflow {
  get(id: string): Promise<{ terminate(): Promise<void> }>;
  createBatch(batch: RolloverInstance[]): Promise<unknown>;
}

export interface RescheduleResult {
  cancelledId: string | null;
  createdId: string | null;
}

export async function rescheduleRollover(
  workflow: RolloverWorkflow,
  input: { workspaceId: string; previous: BriefSchedule; next: BriefSchedule; now: Date },
): Promise<RescheduleResult> {
  const stale = rolloverInstance(input.workspaceId, nextBriefAt(input.previous, input.now), "scheduled");
  const fresh = rolloverInstance(input.workspaceId, nextBriefAt(input.next, input.now), "scheduled");
  if (stale.id === fresh.id) return { cancelledId: null, createdId: null };
  const cancelledId = await workflow
    .get(stale.id)
    .then((instance) => instance.terminate())
    .then(
      () => stale.id,
      () => null,
    );
  await workflow.createBatch([fresh]);
  return { cancelledId, createdId: fresh.id };
}
