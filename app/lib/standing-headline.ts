export interface Headline {
  rank: number;
  of: number;
}

export function headlineFrom(
  rows: readonly { role: string; rank: number }[],
): Headline | null {
  if (rows.length < 2) return null;
  const self = rows.find((row) => row.role === "self");
  if (self === undefined) return null;
  return { rank: self.rank, of: rows.length };
}

export function greetingFor(now: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).format(now),
  );
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}
