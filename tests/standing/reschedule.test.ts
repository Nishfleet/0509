import { describe, expect, it, vi } from "vitest";

import type { BriefSchedule, RolloverInstance } from "../../app/lib/brief-schedule";
import { nextBriefAt, rolloverInstance } from "../../app/lib/brief-schedule";
import { rescheduleRollover } from "../../app/lib/standing/reschedule";

const WS = "ws_reschedule";
const NOW = new Date("2026-09-22T12:00:00Z");
const PREVIOUS: BriefSchedule = { timezone: "UTC", weekday: 1, hour: 8 };
const NEXT: BriefSchedule = { timezone: "UTC", weekday: 3, hour: 9 };
const STALE = rolloverInstance(WS, nextBriefAt(PREVIOUS, NOW), "scheduled");
const FRESH = rolloverInstance(WS, nextBriefAt(NEXT, NOW), "scheduled");

type Lookup = (id: string) => Promise<{ terminate: () => Promise<void> }>;

function fakeWorkflow(lookup: Lookup) {
  return {
    get: vi.fn(lookup),
    createBatch: vi.fn((batch: RolloverInstance[]) => Promise.resolve(batch)),
  };
}

const reschedule = (workflow: ReturnType<typeof fakeWorkflow>, previous: BriefSchedule, next: BriefSchedule) =>
  rescheduleRollover(workflow, { workspaceId: WS, previous, next, now: NOW });

describe("rescheduling the standing rollover (0509#5156)", () => {
  it("terminates the stale instance and creates the fresh one", async () => {
    const terminate = vi.fn(() => Promise.resolve());
    const workflow = fakeWorkflow(() => Promise.resolve({ terminate }));

    const result = await reschedule(workflow, PREVIOUS, NEXT);

    expect(workflow.get).toHaveBeenCalledWith(STALE.id);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(workflow.createBatch).toHaveBeenCalledWith([FRESH]);
    expect(result).toEqual({ cancelledId: STALE.id, createdId: FRESH.id });
  });

  it("still creates the fresh instance when the stale one is gone", async () => {
    const workflow = fakeWorkflow(() => Promise.reject(new Error("instance not found")));

    const result = await reschedule(workflow, PREVIOUS, NEXT);

    expect(workflow.get).toHaveBeenCalledWith(STALE.id);
    expect(workflow.createBatch).toHaveBeenCalledWith([FRESH]);
    expect(result).toEqual({ cancelledId: null, createdId: FRESH.id });
  });

  it("still creates the fresh instance when the termination fails", async () => {
    const terminate = vi.fn(() => Promise.reject(new Error("already terminated")));
    const workflow = fakeWorkflow(() => Promise.resolve({ terminate }));

    const result = await reschedule(workflow, PREVIOUS, NEXT);

    expect(terminate).toHaveBeenCalledTimes(1);
    expect(workflow.createBatch).toHaveBeenCalledWith([FRESH]);
    expect(result).toEqual({ cancelledId: null, createdId: FRESH.id });
  });

  it("leaves the pending instance alone when the schedule resolves to the same instant", async () => {
    const workflow = fakeWorkflow(() => Promise.resolve({ terminate: vi.fn(() => Promise.resolve()) }));

    const result = await reschedule(workflow, NEXT, NEXT);

    expect(workflow.get).not.toHaveBeenCalled();
    expect(workflow.createBatch).not.toHaveBeenCalled();
    expect(result).toEqual({ cancelledId: null, createdId: null });
  });

  it("carries the new instant in the created instance's params", async () => {
    const workflow = fakeWorkflow(() => Promise.resolve({ terminate: vi.fn(() => Promise.resolve()) }));

    await reschedule(workflow, PREVIOUS, NEXT);

    const [batch] = workflow.createBatch.mock.calls[0];
    expect(batch).toEqual([FRESH]);
    expect(batch[0].params.closesAt).toBe(nextBriefAt(NEXT, NOW).toISOString());
    expect(batch[0].params.closesAt).toBe("2026-09-23T09:00:00.000Z");
  });
});
