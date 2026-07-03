import { safeTimeZone } from "~/lib/safe-timezone";

// Customer-facing scan-schedule expectations. Regular scans run every three
// hours; Scout joins the six-hour slots. Labels default to UTC (the product is
// global-first) and accept a workspace timezone so "when will this update?"
// always has an answer in the customer's terms.

const THREE_HOUR_SCAN_UTC_HOURS = [0, 3, 6, 9, 12, 15, 18, 21] as const;
const SIX_HOUR_SCAN_UTC_HOURS = [0, 6, 12, 18] as const;

export function nextScheduledScanAt(plan: string, now: Date = new Date()): Date {
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
