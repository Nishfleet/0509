import { TZDate } from "@date-fns/tz";
import { setDay } from "date-fns";

export interface BriefSchedule {
  timezone: string;
  weekday: number;
  hour: number;
}

export interface BriefWeek {
  startsAt: Date;
  closesAt: Date;
}

function localMidnight(instant: Date, timezone: string): TZDate {
  const local = new TZDate(instant.getTime(), timezone);
  return new TZDate(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, timezone);
}

function civilSlot(schedule: BriefSchedule, day: TZDate): TZDate {
  return new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), schedule.hour, 0, 0, schedule.timezone);
}

function slotInWeekOf(schedule: BriefSchedule, instant: Date): TZDate {
  const day = setDay(localMidnight(instant, schedule.timezone), schedule.weekday);
  return civilSlot(schedule, day);
}

function weekShift(slot: TZDate, schedule: BriefSchedule, weeks: number): TZDate {
  const day = new TZDate(slot.getFullYear(), slot.getMonth(), slot.getDate() + weeks * 7, 0, 0, 0, schedule.timezone);
  return civilSlot(schedule, day);
}

export function nextBriefAt(schedule: BriefSchedule, after: Date): Date {
  const slot = slotInWeekOf(schedule, after);
  const next = slot.getTime() > after.getTime() ? slot : weekShift(slot, schedule, 1);
  return new Date(next.getTime());
}

export function previousBriefAt(schedule: BriefSchedule, before: Date): Date {
  const slot = slotInWeekOf(schedule, before);
  const previous = slot.getTime() < before.getTime() ? slot : weekShift(slot, schedule, -1);
  return new Date(previous.getTime());
}

export function openWeek(schedule: BriefSchedule, now: Date): BriefWeek {
  const closesAt = nextBriefAt(schedule, now);
  return { startsAt: previousBriefAt(schedule, closesAt), closesAt };
}

export function weekClosingAt(schedule: BriefSchedule, closesAt: Date): BriefWeek {
  return { startsAt: previousBriefAt(schedule, closesAt), closesAt };
}

export function instantStamp(instant: Date): string {
  return instant.toISOString().slice(0, 16).replace(/[-:]/g, "");
}

export interface RolloverParams {
  workspaceId: string;
  closesAt: string;
}

export interface RolloverInstance {
  id: string;
  params: RolloverParams;
}

export function rolloverInstance(
  workspaceId: string,
  closesAt: Date,
  kind: "scheduled" | "catch-up",
): RolloverInstance {
  const suffix = kind === "catch-up" ? "-catch-up" : "";
  return {
    id: `rollover-${workspaceId}-${instantStamp(closesAt)}${suffix}`,
    params: { workspaceId, closesAt: closesAt.toISOString() },
  };
}
