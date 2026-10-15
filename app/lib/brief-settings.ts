import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import { zoneName } from "./timezone";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function formatBriefAt(instant: Date, timezone: string): string {
  return `${format(new TZDate(instant.getTime(), timezone), "EEEE d MMMM yyyy, HH:mm")} ${zoneName(timezone, instant)}`;
}

export function formatPausedSince(pausedAt: string, timezone: string): string {
  if (Number.isNaN(Date.parse(pausedAt))) return "an unknown date";
  return format(new TZDate(new Date(pausedAt).getTime(), timezone), "EEEE d MMMM");
}
