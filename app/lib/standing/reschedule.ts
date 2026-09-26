import type { BriefSchedule, RolloverInstance } from "../brief-schedule";
import { nextBriefAt, previousBriefAt, rolloverInstance } from "../brief-schedule";

interface RolloverWorkflow {
  get(id: string): Promise<{ terminate(): Promise<void> }>;
  createBatch(batch: RolloverInstance[]): Promise<unknown>;
}

export interface RescheduleResult {
  cancelledId: string | null;
  createdId: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

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
  const due = previousBriefAt(input.next, input.now);
  const age = input.now.getTime() - due.getTime();
  const catchUp = age >= 0 && age < HOUR_MS ? rolloverInstance(input.workspaceId, due, "catch-up") : null;
  await workflow.createBatch(catchUp === null ? [fresh] : [fresh, catchUp]);
  return { cancelledId, createdId: fresh.id };
}
