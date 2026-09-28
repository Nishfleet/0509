import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { openWeek, previousBriefAt, rolloverInstance, type BriefSchedule } from "../../app/lib/brief-schedule";
import {
  CATCH_UP_GRACE_MS,
  planRollovers,
  unrankedWeekKey,
  type WorkspaceSchedule,
} from "../../workers/standing/rollover-plan";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const UTC_MONDAY: BriefSchedule = { timezone: "UTC", weekday: 1, hour: 8 };
const NOW = new Date("2026-09-24T03:00:00.000Z");
const WS = "ws_due";

function workspace(id: string): WorkspaceSchedule {
  return { workspaceId: id, schedule: UTC_MONDAY, briefPausedAt: null };
}

describe("nightly standing enqueue (0509#5753)", () => {
  it("fails if the nightly cron awaits per-workspace work in a loop", async () => {
    const source = await readFile(path.join(REPO_ROOT, "workers/standing/nightly.ts"), "utf8");
    expect(source).toContain("createRollovers");
    expect(source).not.toMatch(/reduce\s*(?:<[^>]*>)?\s*\(\s*async/);
    expect(source).not.toMatch(/await refreshWorkspaceScores/);
    expect(source).not.toMatch(/await planWorkspace/);
    expect(source).not.toMatch(/for\s*\([^)]*\sof\s[^)]+\)\s*\{[^}]*\bawait\b/);
  });

  it("schedules the next close and a catch-up when the last week is unranked past grace", () => {
    const week = openWeek(UTC_MONDAY, NOW);
    const closedWeekStart = previousBriefAt(UTC_MONDAY, week.startsAt).toISOString();
    const { scheduled, catchUps } = planRollovers(
      [workspace(WS)],
      new Set([unrankedWeekKey(WS, closedWeekStart)]),
      NOW,
    );

    expect(scheduled).toEqual([rolloverInstance(WS, week.closesAt, "scheduled")]);
    expect(catchUps).toEqual([rolloverInstance(WS, week.startsAt, "catch-up")]);
    expect(NOW.getTime() - week.startsAt.getTime()).toBeGreaterThan(CATCH_UP_GRACE_MS);
  });

  it("does not catch up inside the grace window", () => {
    const week = openWeek(UTC_MONDAY, NOW);
    const justClosed = new Date(week.startsAt.getTime() + 1_000);
    const closedWeekStart = previousBriefAt(UTC_MONDAY, week.startsAt).toISOString();
    const { catchUps } = planRollovers(
      [workspace(WS)],
      new Set([unrankedWeekKey(WS, closedWeekStart)]),
      justClosed,
    );
    expect(catchUps).toEqual([]);
  });

  it("does not catch up a week that already has ranks", () => {
    const { catchUps } = planRollovers([workspace(WS)], new Set(), NOW);
    expect(catchUps).toEqual([]);
  });
});
