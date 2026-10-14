import { z } from "zod";

import type { BriefSchedule } from "./brief-schedule";
import { canonicalTimezone } from "./timezone";

const numberField = (minimum: number, maximum: number) =>
  z.union([z.number(), z.string().trim().min(1)]).pipe(z.coerce.number<number>().int().min(minimum).max(maximum));

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

export function parseBriefSchedule(
  input: Partial<Record<"weekday" | "hour" | "timezone", unknown>>,
): BriefSchedule | null {
  const parsed = briefScheduleInput.safeParse(input);
  if (!parsed.success) return null;
  return { weekday: parsed.data.weekday, hour: parsed.data.hour, timezone: parsed.data.timezone };
}
