import type { BriefPayload } from "./brief-payload";
import type { BriefSchedule } from "./brief-schedule";
import { homeStanding } from "./home-standing";
import type { HomeCount, HomeEntity, HomeSource } from "./home-standing";

export interface ShareCard {
  brand: string;
  rank: number;
  total: number;
  week: string;
}

function weekLabel(periodEnd: string, timezone: string): string {
  const end = new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return "This week";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "long" }).format(end);
  return `Week to ${day}`;
}

export function shareCard(input: {
  payload: BriefPayload | null;
  entities: readonly HomeEntity[];
  sources: readonly HomeSource[];
  counts: readonly HomeCount[];
  schedule: BriefSchedule;
  now: Date;
}): ShareCard | null {
  const standing = homeStanding(input);
  if (standing.kind !== "ranked" || input.payload === null) return null;
  const self = standing.rows.find((row) => row.self);
  if (self === undefined) return null;
  return {
    brand: self.name,
    rank: standing.rank,
    total: standing.total,
    week: weekLabel(input.payload.period_end, input.schedule.timezone),
  };
}
