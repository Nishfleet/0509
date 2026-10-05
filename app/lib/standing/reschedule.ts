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

interface RescheduleInput {
  workspaceId: string;
  previous: BriefSchedule;
  next: BriefSchedule;
  now: Date;
  lastBriefPeriodEnd: Date | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_TOLERANCE_MS = 6 * DAY_MS;

function freshSlot(input: RescheduleInput): Date {
  const slot = nextBriefAt(input.next, input.now);
  const last = input.lastBriefPeriodEnd;
  return last !== null && slot.getTime() - last.getTime() < DAY_MS ? nextBriefAt(input.next, slot) : slot;
}

function catchUpDue(input: RescheduleInput, staleAt: Date): Date | null {
  const due = previousBriefAt(input.next, input.now);
  const last = input.lastBriefPeriodEnd;
  const unbriefed = last === null || due.getTime() - last.getTime() >= WEEK_TOLERANCE_MS;
  const age = input.now.getTime() - due.getTime();
  const staleCoversDue = staleAt.getTime() - due.getTime() < WEEK_TOLERANCE_MS;
  return unbriefed && age >= 0 && (age < HOUR_MS || staleCoversDue) ? due : null;
}

export async function rescheduleRollover(
  workflow: RolloverWorkflow,
  input: RescheduleInput,
): Promise<RescheduleResult> {
  const staleAt = nextBriefAt(input.previous, input.now);
  const stale = rolloverInstance(input.workspaceId, staleAt, "scheduled");
  const fresh = rolloverInstance(input.workspaceId, freshSlot(input), "scheduled");
  if (stale.id === fresh.id) return { cancelledId: null, createdId: null };
  const cancelledId = await workflow
    .get(stale.id)
    .then((instance) => instance.terminate())
    .then(
      () => stale.id,
      () => null,
    );
  const due = catchUpDue(input, staleAt);
  const catchUp = due === null ? null : rolloverInstance(input.workspaceId, due, "catch-up");
  await workflow.createBatch(catchUp === null ? [fresh] : [fresh, catchUp]);
  return { cancelledId, createdId: fresh.id };
}
