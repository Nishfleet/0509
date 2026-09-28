import { describe, expect, it, vi } from "vitest";

import { openWeek, previousBriefAt, rolloverInstance, type BriefSchedule } from "../../app/lib/brief-schedule";
import {
  CATCH_UP_GRACE_MS,
  createRollovers,
  loadNightlyPlan,
  planRollovers,
  unrankedWeekKey,
  type WorkspaceSchedule,
} from "../../workers/standing/rollover-plan";

const UTC_MONDAY: BriefSchedule = { timezone: "UTC", weekday: 1, hour: 8 };
const NOW = new Date("2026-09-24T03:00:00.000Z");
const WS = "ws_due";

function workspace(id: string): WorkspaceSchedule {
  return { workspaceId: id, schedule: UTC_MONDAY, briefPausedAt: null };
}

function scheduleRow(id: string) {
  return {
    id,
    timezone: UTC_MONDAY.timezone,
    brief_weekday: UTC_MONDAY.weekday,
    brief_hour: UTC_MONDAY.hour,
    brief_paused_at: null,
  };
}

function fakeDb(schedules: ReturnType<typeof scheduleRow>[], unranked: { workspace_id: string; week_start_at: string }[]) {
  const prepares: string[] = [];
  return {
    prepares,
    db: {
      prepare(sql: string) {
        prepares.push(sql);
        const results = sql.includes("FROM standing") ? unranked : schedules;
        const stmt = {
          bind: () => stmt,
          all: async () => ({ results }),
        };
        return stmt;
      },
    } as unknown as D1Database,
  };
}

describe("nightly standing enqueue (0509#5753)", () => {
  it("loads every due workspace with two queries and one createBatch, never per-workspace scoring", async () => {
    const count = 50;
    const rows = Array.from({ length: count }, (_, index) => scheduleRow(`ws_${String(index)}`));
    const { prepares, db } = fakeDb(rows, []);
    const createBatch = vi.fn(async (batch: unknown[]) => batch);
    const plan = await loadNightlyPlan(db, NOW);
    const created = await createRollovers({ createBatch } as never, plan.scheduled);

    expect(prepares).toHaveLength(2);
    expect(plan.workspaces).toBe(count);
    expect(plan.scheduled).toHaveLength(count);
    expect(plan.catchUpAt).toEqual([]);
    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(created).toBe(count);
  });

  it("schedules the next close and a catch-up when the last week is unranked past grace", () => {
    const week = openWeek(UTC_MONDAY, NOW);
    const closedWeekStart = previousBriefAt(UTC_MONDAY, week.startsAt).toISOString();
    const { scheduled, catchUpAt } = planRollovers(
      [workspace(WS)],
      new Set([unrankedWeekKey(WS, closedWeekStart)]),
      NOW,
    );

    expect(scheduled).toEqual([rolloverInstance(WS, week.closesAt, "scheduled")]);
    expect(catchUpAt).toEqual([{ workspaceId: WS, closesAt: week.startsAt }]);
    expect(NOW.getTime() - week.startsAt.getTime()).toBeGreaterThan(CATCH_UP_GRACE_MS);
  });

  it("does not catch up inside the grace window", () => {
    const week = openWeek(UTC_MONDAY, NOW);
    const justClosed = new Date(week.startsAt.getTime() + 1_000);
    const closedWeekStart = previousBriefAt(UTC_MONDAY, week.startsAt).toISOString();
    const { catchUpAt } = planRollovers(
      [workspace(WS)],
      new Set([unrankedWeekKey(WS, closedWeekStart)]),
      justClosed,
    );
    expect(catchUpAt).toEqual([]);
  });

  it("does not catch up a week that already has ranks", () => {
    const { catchUpAt } = planRollovers([workspace(WS)], new Set(), NOW);
    expect(catchUpAt).toEqual([]);
  });
});
