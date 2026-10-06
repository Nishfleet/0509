import { describe, expect, it, vi } from "vitest";

import type { BriefSchedule, RolloverInstance } from "../../app/lib/brief-schedule";
import { nextBriefAt, previousBriefAt, rolloverInstance } from "../../app/lib/brief-schedule";
import { cancelRollover, rescheduleRollover } from "../../app/lib/standing/reschedule";

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
  rescheduleRollover(workflow, { workspaceId: WS, previous, next, now: NOW, lastBriefPeriodEnd: null });

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

  it("includes the due week's catch-up in the same batch when that slot started this hour", async () => {
    const now = new Date("2026-09-25T09:43:00.000Z");
    const next: BriefSchedule = { timezone: "UTC", weekday: 5, hour: 9 };
    const catchUp = rolloverInstance(WS, previousBriefAt(next, now), "catch-up");
    const fresh = rolloverInstance(WS, nextBriefAt(next, now), "scheduled");
    const stale = rolloverInstance(WS, nextBriefAt(PREVIOUS, now), "scheduled");
    const workflow = fakeWorkflow(() => Promise.resolve({ terminate: vi.fn(() => Promise.resolve()) }));

    const result = await rescheduleRollover(workflow, {
      workspaceId: WS,
      previous: PREVIOUS,
      next,
      now,
      lastBriefPeriodEnd: null,
    });

    expect(workflow.get).toHaveBeenCalledWith(stale.id);
    expect(workflow.createBatch).toHaveBeenCalledTimes(1);
    expect(workflow.createBatch).toHaveBeenCalledWith([fresh, catchUp]);
    expect(catchUp.params.closesAt).toBe("2026-09-25T09:00:00.000Z");
    expect(result).toEqual({ cancelledId: stale.id, createdId: fresh.id });
  });

  it("does not create a catch-up when the saved time is unchanged", async () => {
    const now = new Date("2026-09-25T09:43:00.000Z");
    const next: BriefSchedule = { timezone: "UTC", weekday: 5, hour: 9 };
    const workflow = fakeWorkflow(() => Promise.resolve({ terminate: vi.fn(() => Promise.resolve()) }));

    const result = await rescheduleRollover(workflow, {
      workspaceId: WS,
      previous: next,
      next,
      now,
      lastBriefPeriodEnd: null,
    });

    expect(workflow.get).not.toHaveBeenCalled();
    expect(workflow.createBatch).not.toHaveBeenCalled();
    expect(result).toEqual({ cancelledId: null, createdId: null });
  });

  it("does not create a catch-up when this week was already briefed", async () => {
    const now = new Date("2026-09-25T10:20:00.000Z");
    const previous: BriefSchedule = { timezone: "UTC", weekday: 5, hour: 9 };
    const next: BriefSchedule = { timezone: "UTC", weekday: 5, hour: 10 };
    const lastBriefPeriodEnd = new Date("2026-09-25T09:00:00.000Z");
    const stale = rolloverInstance(WS, nextBriefAt(previous, now), "scheduled");
    const fresh = rolloverInstance(WS, nextBriefAt(next, now), "scheduled");
    const workflow = fakeWorkflow(() => Promise.resolve({ terminate: vi.fn(() => Promise.resolve()) }));

    const result = await rescheduleRollover(workflow, {
      workspaceId: WS,
      previous,
      next,
      now,
      lastBriefPeriodEnd,
    });

    expect(workflow.createBatch).toHaveBeenCalledTimes(1);
    expect(workflow.createBatch).toHaveBeenCalledWith([fresh]);
    expect(result).toEqual({ cancelledId: stale.id, createdId: fresh.id });
  });

  describe("brief-day changes send exactly one brief that week (0509#7075)", () => {
    const monday8: BriefSchedule = { timezone: "UTC", weekday: 1, hour: 8 };
    const run = async (input: { previous: BriefSchedule; next: BriefSchedule; now: string; last: string | null }) => {
      const workflow = fakeWorkflow(() => Promise.resolve({ terminate: vi.fn(() => Promise.resolve()) }));
      await rescheduleRollover(workflow, {
        workspaceId: WS,
        previous: input.previous,
        next: input.next,
        now: new Date(input.now),
        lastBriefPeriodEnd: input.last === null ? null : new Date(input.last),
      });
      const [batch] = workflow.createBatch.mock.calls[0];
      return batch.map((instance: RolloverInstance) => instance.params.closesAt);
    };

    it("moving the hour later after the brief went out does not send a second one", async () => {
      const closes = await run({
        previous: monday8,
        next: { ...monday8, hour: 9 },
        now: "2026-10-05T08:30:00Z",
        last: "2026-10-05T08:00:00Z",
      });
      expect(closes).toEqual(["2026-10-12T09:00:00.000Z"]);
    });

    it("moving the hour earlier before the slot catches up instead of skipping to the next week", async () => {
      const closes = await run({
        previous: monday8,
        next: { ...monday8, hour: 6 },
        now: "2026-10-05T07:30:00Z",
        last: "2026-09-28T08:00:00Z",
      });
      expect(closes).toEqual(["2026-10-12T06:00:00.000Z", "2026-10-05T06:00:00.000Z"]);
    });

    it("the device-zone change on Monday after the new slot passed still sends this week", async () => {
      const closes = await run({
        previous: monday8,
        next: { timezone: "Asia/Calcutta", weekday: 1, hour: 8 },
        now: "2026-10-05T04:00:00Z",
        last: "2026-09-28T08:00:00Z",
      });
      expect(closes).toEqual(["2026-10-12T02:30:00.000Z", "2026-10-05T02:30:00.000Z"]);
    });

    it("a zone captured on Sunday moves the Monday brief with no catch-up", async () => {
      const closes = await run({
        previous: monday8,
        next: { timezone: "Asia/Calcutta", weekday: 1, hour: 8 },
        now: "2026-10-11T10:00:00Z",
        last: "2026-10-05T02:30:00Z",
      });
      expect(closes).toEqual(["2026-10-12T02:30:00.000Z"]);
    });
  });
  describe("the catch-up window closes after exactly one hour", () => {
    const thursday9: BriefSchedule = { timezone: "UTC", weekday: 4, hour: 9 };
    const friday9: BriefSchedule = { timezone: "UTC", weekday: 5, hour: 9 };
    const run = async (now: string) => {
      const workflow = fakeWorkflow(() => Promise.resolve({ terminate: vi.fn(() => Promise.resolve()) }));
      await rescheduleRollover(workflow, {
        workspaceId: WS,
        previous: thursday9,
        next: friday9,
        now: new Date(now),
        lastBriefPeriodEnd: null,
      });
      const [batch] = workflow.createBatch.mock.calls[0];
      return batch.map((instance: RolloverInstance) => instance.params.closesAt);
    };

    it("catches up one millisecond inside the hour", async () => {
      expect(await run("2026-09-25T09:59:59.999Z")).toEqual(["2026-10-02T09:00:00.000Z", "2026-09-25T09:00:00.000Z"]);
    });

    it("does not catch up at exactly one hour", async () => {
      expect(await run("2026-09-25T10:00:00.000Z")).toEqual(["2026-10-02T09:00:00.000Z"]);
    });
  });

  describe("a zone whose hour shifts keeps one brief a week across the transition (0509#7075)", () => {
    const sunday9: BriefSchedule = { timezone: "America/New_York", weekday: 0, hour: 9 };
    const sunday8: BriefSchedule = { timezone: "America/New_York", weekday: 0, hour: 8 };
    const run = async (input: { now: string; last: string | null }) => {
      const workflow = fakeWorkflow(() => Promise.resolve({ terminate: vi.fn(() => Promise.resolve()) }));
      await rescheduleRollover(workflow, {
        workspaceId: WS,
        previous: sunday9,
        next: sunday8,
        now: new Date(input.now),
        lastBriefPeriodEnd: input.last === null ? null : new Date(input.last),
      });
      const [batch] = workflow.createBatch.mock.calls[0];
      return batch.map((instance: RolloverInstance) => instance.params.closesAt);
    };

    describe("clocks go back on 2026-11-01", () => {
      const now = "2026-11-01T13:30:00.000Z";

      it("catches up the slot that started this hour when last week's brief went out an hour earlier in UTC", async () => {
        expect(await run({ now, last: "2026-10-25T12:00:00.000Z" })).toEqual([
          "2026-11-08T13:00:00.000Z",
          "2026-11-01T13:00:00.000Z",
        ]);
      });

      it("counts a brief exactly six real days before the slot as last week's", async () => {
        expect(await run({ now, last: "2026-10-26T13:00:00.000Z" })).toEqual([
          "2026-11-08T13:00:00.000Z",
          "2026-11-01T13:00:00.000Z",
        ]);
      });

      it("counts a brief one millisecond inside six real days as this week's", async () => {
        expect(await run({ now, last: "2026-10-26T13:00:00.001Z" })).toEqual(["2026-11-08T13:00:00.000Z"]);
      });

      it("pushes the fresh slot a week when the last brief is 23 real hours 30 minutes before it", async () => {
        expect(await run({ now: "2026-10-31T14:00:00.000Z", last: "2026-10-31T13:30:00.000Z" })).toEqual([
          "2026-11-08T13:00:00.000Z",
        ]);
      });
    });

    describe("clocks go forward on 2026-03-08", () => {
      const now = "2026-03-07T14:00:00.000Z";

      it("pushes the fresh slot a week when the last brief is 23 real hours before it", async () => {
        expect(await run({ now, last: "2026-03-07T13:00:00.000Z" })).toEqual(["2026-03-15T12:00:00.000Z"]);
      });

      it("keeps the fresh slot when the last brief is exactly 24 real hours before it", async () => {
        expect(await run({ now, last: "2026-03-07T12:00:00.000Z" })).toEqual(["2026-03-08T12:00:00.000Z"]);
      });

      it("treats a brief 6 days 23 hours before the due slot as last week's, so the new week still catches up", async () => {
        const closes = await run({ now: "2026-03-08T12:30:00.000Z", last: "2026-03-01T13:00:00.000Z" });
        expect(closes).toEqual(["2026-03-15T12:00:00.000Z", "2026-03-08T12:00:00.000Z"]);
      });
    });
  });
});

describe("cancelling the pending rollover when the workspace goes (0509#7191)", () => {
  it("terminates the instance for the next brief slot", async () => {
    const terminate = vi.fn(() => Promise.resolve());
    const workflow = fakeWorkflow(() => Promise.resolve({ terminate }));

    const cancelled = await cancelRollover(workflow, { workspaceId: WS, schedule: PREVIOUS, now: NOW });

    expect(workflow.get).toHaveBeenCalledWith(STALE.id);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(STALE.id);
  });

  it("answers null when there is no instance to terminate", async () => {
    const workflow = fakeWorkflow(() => Promise.reject(new Error("instance.not_found")));

    expect(await cancelRollover(workflow, { workspaceId: WS, schedule: PREVIOUS, now: NOW })).toBeNull();
  });
});
