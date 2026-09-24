const DAY_MS = 24 * 60 * 60 * 1000;

const RELATIVE_DAYS = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function daysAgoLabel(at: string, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / DAY_MS));
  return RELATIVE_DAYS.format(-days, "day");
}
