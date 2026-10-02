export type DayGroup = "Today" | "Yesterday" | "Earlier";

const DAY_GROUPS: readonly DayGroup[] = ["Today", "Yesterday", "Earlier"];

function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function time(at: string): number {
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
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
  const sorted = [...items].sort((a, b) => time(b.at) - time(a.at));
  return DAY_GROUPS.map((group) => ({
    group,
    items: sorted.filter((item) => alertDayGroup(item.at, now, timeZone) === group),
  })).filter((entry) => entry.items.length > 0);
}
