// Customer-facing scan-schedule expectations. The nightly scan cron is
// 0 4 * * * UTC; scout watchlists only join the Monday run. Shown in IST
// (the launch market) so "when will this update?" always has an answer.

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

export function formatNextScanLabel(plan: string, now: Date = new Date()): string {
  const next = nextScheduledScanAt(plan, now);
  const formatted = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(next);

  return `${formatted} IST`;
}
