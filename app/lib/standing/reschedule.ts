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

function alreadyExists(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("already exist") || message.includes("already_exists");
}

function catchUpDueNow(
  workspaceId: string,
  schedule: BriefSchedule,
  now: Date,
): RolloverInstance | null {
  const missedClose = previousBriefAt(schedule, now);
  const age = now.getTime() - missedClose.getTime();
  if (age < 0 || age >= HOUR_MS) return null;
  return rolloverInstance(workspaceId, missedClose, "catch-up");
}

async function createCatchUp(workflow: RolloverWorkflow, catchUp: RolloverInstance | null): Promise<void> {
  if (catchUp === null) return;
  try {
    await workflow.createBatch([catchUp]);
  } catch (error) {
    if (!alreadyExists(error)) throw error;
  }
}

export async function rescheduleRollover(
  workflow: RolloverWorkflow,
  input: { workspaceId: string; previous: BriefSchedule; next: BriefSchedule; now: Date },
): Promise<RescheduleResult> {
  const stale = rolloverInstance(input.workspaceId, nextBriefAt(input.previous, input.now), "scheduled");
  const fresh = rolloverInstance(input.workspaceId, nextBriefAt(input.next, input.now), "scheduled");
  const catchUp = catchUpDueNow(input.workspaceId, input.next, input.now);
  if (stale.id === fresh.id) {
    await createCatchUp(workflow, catchUp);
    return { cancelledId: null, createdId: catchUp?.id ?? null };
  }
  const cancelledId = await workflow
    .get(stale.id)
    .then((instance) => instance.terminate())
    .then(
      () => stale.id,
      () => null,
    );
  await workflow.createBatch([fresh]);
  await createCatchUp(workflow, catchUp);
  return { cancelledId, createdId: fresh.id };
}
