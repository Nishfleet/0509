import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";

import type { BriefSchedule } from "./brief-schedule";
import { canonicalTimezone } from "./timezone";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

const numberField = (minimum: number, maximum: number) =>
  z
    .union([z.number(), z.string().trim().min(1)])
    .pipe(z.coerce.number<number>().int().min(minimum).max(maximum));

const briefScheduleInput = z.object({
  weekday: numberField(0, 6),
  hour: numberField(0, 23),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((zone) => zone === "UTC" || canonicalTimezone(zone) === zone),
});

export function parseBriefSchedule(input: {
  weekday: unknown;
  hour: unknown;
  timezone: unknown;
}): BriefSchedule | null {
  const parsed = briefScheduleInput.safeParse(input);
  if (!parsed.success) return null;
  return { weekday: parsed.data.weekday, hour: parsed.data.hour, timezone: parsed.data.timezone };
}

export function formatBriefAt(instant: Date, timezone: string): string {
  return `${format(new TZDate(instant.getTime(), timezone), "EEEE d MMMM yyyy, HH:mm")} ${timezone}`;
}

export function formatPausedSince(pausedAt: string, timezone: string): string {
  return format(new TZDate(new Date(pausedAt).getTime(), timezone), "EEEE d MMMM");
}
