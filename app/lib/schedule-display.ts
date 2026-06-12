import { safeTimeZone } from "~/lib/safe-timezone";

// Customer-facing scan-schedule expectations. The nightly scan cron is
// 0 4 * * * UTC; scout watchlists only join the Monday run. Labels default
// to UTC (the product is global-first) and accept a workspace timezone so
// "when will this update?" always has an answer in the customer's terms.

const DAILY_SCAN_UTC_HOUR = 4;

export function nextScheduledScanAt(plan: string, now: Date = new Date()): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DAILY_SCAN_UTC_HOUR, 0, 0),
  );

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  if (plan === "scout") {
    while (next.getUTCDay() !== 1) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
  }

  return next;
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
