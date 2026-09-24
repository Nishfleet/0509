import { TZDate } from "@date-fns/tz";
import { addWeeks, setDay, setHours, startOfHour, subWeeks } from "date-fns";

export interface BriefSchedule {
  timezone: string;
  weekday: number;
  hour: number;
}

export interface BriefWeek {
  startsAt: Date;
  closesAt: Date;
}

function slotInWeekOf(schedule: BriefSchedule, instant: Date): TZDate {
  const local = new TZDate(instant.getTime(), schedule.timezone);
  return startOfHour(setHours(setDay(local, schedule.weekday), schedule.hour));
}

export function nextBriefAt(schedule: BriefSchedule, after: Date): Date {
  const slot = slotInWeekOf(schedule, after);
  const next = slot.getTime() > after.getTime() ? slot : addWeeks(slot, 1);
  return new Date(next.getTime());
}

export function previousBriefAt(schedule: BriefSchedule, before: Date): Date {
  const slot = slotInWeekOf(schedule, before);
  const previous = slot.getTime() < before.getTime() ? slot : subWeeks(slot, 1);
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
