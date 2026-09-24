export type DayGroup = "New" | "Yesterday" | "Earlier";

const DAY_GROUPS: readonly DayGroup[] = ["New", "Yesterday", "Earlier"];

function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function alertDayGroup(at: string, now: Date, timeZone: string): DayGroup {
  const today = localDay(now, timeZone);
  const [year, month, day] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
  const atDay = localDay(new Date(at), timeZone);
  if (atDay >= today) return "New";
  if (atDay === yesterday) return "Yesterday";
  return "Earlier";
}

export function groupByDay<T extends { at: string }>(
  items: readonly T[],
  now: Date,
  timeZone: string,
): { group: DayGroup; items: T[] }[] {
  const sorted = [...items].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return DAY_GROUPS.map((group) => ({
    group,
    items: sorted.filter((item) => alertDayGroup(item.at, now, timeZone) === group),
  })).filter((entry) => entry.items.length > 0);
}
