import { TZDate } from "@date-fns/tz";
import { format, startOfDay } from "date-fns";

export type DayGroup = "Today" | "Yesterday" | "Earlier";

const DAY_GROUPS: readonly DayGroup[] = ["Today", "Yesterday", "Earlier"];

export function localDay(at: Date, timeZone: string): string {
  return format(new TZDate(at.getTime(), timeZone), "yyyy-MM-dd");
}

export function startOfLocalDay(now: Date, timeZone: string): Date {
  return new Date(startOfDay(new TZDate(now.getTime(), timeZone)).getTime());
}

function time(at: string): number {
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? Number.MIN_SAFE_INTEGER : parsed;
}

const RELATIVE_DAYS = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

export function localDaysAgoLabel(at: string, now: Date, timeZone: string): string {
  if (Number.isNaN(Date.parse(at))) return "date unknown";
  const days = Math.max(0, dayNumber(localDay(now, timeZone)) - dayNumber(localDay(new Date(at), timeZone)));
  return RELATIVE_DAYS.format(-days, "day");
}

export function alertDayGroup(at: string, now: Date, timeZone: string): DayGroup {
  if (Number.isNaN(Date.parse(at))) return "Earlier";
  const today = localDay(now, timeZone);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const atDay = localDay(new Date(at), timeZone);
  if (atDay >= today) return "Today";
  if (atDay === yesterday) return "Yesterday";
  return "Earlier";
}

export function groupByDay<T extends { at: string }>(
  items: readonly T[],
  now: Date,
  timeZone: string,
): { group: DayGroup; items: T[] }[] {
  const sorted = [...items].sort((a, b) => time(b.at) - time(a.at) || 0);
  return DAY_GROUPS.map((group) => ({
    group,
    items: sorted.filter((item) => alertDayGroup(item.at, now, timeZone) === group),
  })).filter((entry) => entry.items.length > 0);
}
