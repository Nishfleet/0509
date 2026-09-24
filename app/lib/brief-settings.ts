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

const fieldNumber = (minimum: number, maximum: number) =>
  z
    .string()
    .min(1)
    .transform((value) => Number(value))
    .pipe(z.number().int().min(minimum).max(maximum));

const briefScheduleInput = z.object({
  weekday: fieldNumber(0, 6),
  hour: fieldNumber(0, 23),
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

const scheduleForm = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  hour: z.coerce.number().int().min(0).max(23),
  timezone: z.string().trim().min(1).max(100),
});

export function parseScheduleForm(form: FormData): BriefSchedule | null {
  const parsed = scheduleForm.safeParse({
    weekday: form.get("weekday"),
    hour: form.get("hour"),
    timezone: form.get("timezone"),
  });
  if (!parsed.success) return null;
  const timezone = canonicalTimezone(parsed.data.timezone);
  if (timezone !== parsed.data.timezone) return null;
  return { weekday: parsed.data.weekday, hour: parsed.data.hour, timezone };
}

export function nextBriefLine(at: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return `Next one: ${day}`;
}
