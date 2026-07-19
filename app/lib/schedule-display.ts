import { safeTimeZone } from "~/lib/safe-timezone";

// Customer-facing scan-schedule expectations. Paid plans run regular scans;
// free has one scheduled check per week (the Monday 03:00 UTC slot of the
// regular cron — see isWeeklyAlignedScan in plan-entitlements).
// Labels default to UTC and accept a workspace timezone so "when will this
// update?" always has an answer in the customer's terms.

import {
  WEEKLY_SCAN_UTC_DAY,
  WEEKLY_SCAN_UTC_HOUR,
} from "~/lib/plan-entitlements";

const THREE_HOUR_SCAN_UTC_HOURS = [0, 3, 6, 9, 12, 15, 18, 21] as const;
const SIX_HOUR_SCAN_UTC_HOURS = [0, 6, 12, 18] as const;

export function nextScheduledScanAt(plan: string, now: Date = new Date()): Date {
  if (plan === "free") {
    // Next Monday 03:00 UTC strictly after `now`.
    for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
      const candidate = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + dayOffset,
          WEEKLY_SCAN_UTC_HOUR,
          0,
          0,
        ),
      );
      if (
        candidate.getUTCDay() === WEEKLY_SCAN_UTC_DAY &&
        candidate.getTime() > now.getTime()
      ) {
        return candidate;
      }
    }
  }

  const scanHours = plan === "scout" ? SIX_HOUR_SCAN_UTC_HOURS : THREE_HOUR_SCAN_UTC_HOURS;

  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of scanHours) {
      const candidate = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + dayOffset,
          hour,
          0,
          0,
        ),
      );
      if (candidate.getTime() > now.getTime()) {
        return candidate;
      }
    }
  }

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      scanHours[0],
      0,
      0,
    ),
  );
}

export function formatNextScanLabel(
  plan: string,
  now: Date = new Date(),
  timeZone?: string | null,
): string {
  const next = nextScheduledScanAt(plan, now);

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: safeTimeZone(timeZone),
    timeZoneName: "short",
  }).format(next);
}
