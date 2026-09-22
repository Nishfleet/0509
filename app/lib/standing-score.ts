import { TZDate } from "@date-fns/tz";
import { addDays } from "date-fns";

export interface WeightRow {
  key: string;
  weight: number;
  effectiveFrom: string;
}

export interface SignalInput {
  id: string;
  kind: string;
  aspect: string | null;
  publishedAt: string | null;
  observedAt: string;
  reliability: string;
  d3p: number | null;
  d5p: number | null;
  d6p: number | null;
}

export interface RankInput {
  entityId: string;
  score: number;
  previousRank: number | null;
}

export interface FrozenRank {
  entityId: string;
  rank: number;
  movement: number | null;
}

export interface WorkspaceClock {
  id: string;
  timezone: string;
  briefWeekday: number;
  briefHour: number;
}

const MATTERS = 0.9;
const DISCARD_AT = 0.1;
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

export function weightsAsOf(rows: WeightRow[], weekStartAt: string): Map<string, number> {
  const best = new Map<string, WeightRow>();
  for (const row of rows) {
    if (row.effectiveFrom > weekStartAt) continue;
    const current = best.get(row.key);
    if (!current || row.effectiveFrom > current.effectiveFrom) best.set(row.key, row);
  }
  const weights = new Map<string, number>();
  for (const [key, row] of best) weights.set(key, row.weight);
  return weights;
}

function reliabilityKey(reliability: string): string {
  return `reliability_${reliability}`;
}

export function contributionKey(signal: SignalInput, windowStart: string, windowEnd: string): string | null {
  if (signal.kind === "mention") {
    const kept = signal.d5p === null || signal.d5p > DISCARD_AT;
    if (!kept || signal.d6p === null) return null;
    if (signal.d6p >= MATTERS) return "mention_matters";
    if (signal.d6p > DISCARD_AT && signal.d6p < MATTERS) return "mention_normal";
    return null;
  }
  if (signal.kind === "change") {
    if (signal.d3p !== null && signal.d3p >= MATTERS) return "site_change_noteworthy";
    return null;
  }
  if (signal.kind === "ad") {
    if (signal.aspect) return "ad_copy_change";
    if (signal.publishedAt && signal.publishedAt >= windowStart && signal.publishedAt < windowEnd) {
      return "ad_new_creative";
    }
    return null;
  }
  if (signal.kind === "hiring") return "hiring_new_role";
  return null;
}

export function scoreSignals(
  signals: SignalInput[],
  weights: Map<string, number>,
  windowStart: string,
  windowEnd: string,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const signal of signals) {
    if (seen.has(signal.id)) continue;
    seen.add(signal.id);
    const key = contributionKey(signal, windowStart, windowEnd);
    if (!key) continue;
    const weight = weights.get(key);
    const multiplier = weights.get(reliabilityKey(signal.reliability));
    if (weight === undefined || multiplier === undefined) continue;
    total += weight * multiplier;
  }
  return total;
}

export function freezeRanks(rows: RankInput[]): FrozenRank[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.previousRank === null && b.previousRank === null) {
      return a.entityId < b.entityId ? -1 : 1;
    }
    if (a.previousRank === null) return 1;
    if (b.previousRank === null) return -1;
    if (a.previousRank !== b.previousRank) return a.previousRank - b.previousRank;
    return a.entityId < b.entityId ? -1 : 1;
  });
  return sorted.map((row, index) => {
    const rank = index + 1;
    return {
      entityId: row.entityId,
      rank,
      movement: row.previousRank === null ? null : row.previousRank - rank,
    };
  });
}

export function nextRolloverInstant(now: Date, timeZone: string, weekday: number, hour: number): string {
  const zoned = new TZDate(now.getTime(), timeZone);
  let candidate = new TZDate(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), hour, 0, 0, 0, timeZone);
  const delta = (weekday - candidate.getDay() + 7) % 7;
  candidate = addDays(candidate, delta);
  if (candidate.getTime() <= now.getTime()) candidate = addDays(candidate, 7);
  return new Date(candidate.getTime()).toISOString();
}

export function shiftWeek(weekStartIso: string, timeZone: string, days: number): string {
  const zoned = new TZDate(Date.parse(weekStartIso), timeZone);
  return new Date(addDays(zoned, days).getTime()).toISOString();
}

export function currentWeekStart(now: Date, timeZone: string, weekday: number, hour: number): string {
  return shiftWeek(nextRolloverInstant(now, timeZone, weekday, hour), timeZone, -7);
}

export function weekClosedBy(runAtIso: string, timeZone: string): string {
  return shiftWeek(runAtIso, timeZone, -7);
}

export function needsCatchUp(latestWeekStart: string | null, currentWeekStartIso: string): boolean {
  if (latestWeekStart === null) return true;
  return Date.parse(currentWeekStartIso) - Date.parse(latestWeekStart) > EIGHT_DAYS_MS;
}

export function briefError(timezone: string, weekday: number, hour: number): string | null {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return "Weekday must be 0-6.";
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "Hour must be 0-23.";
  try {
    Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return "Timezone is not a recognized IANA zone.";
  }
  return null;
}

export function instanceId(workspaceId: string, runAt: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9_]/g, "_");
  return `standing_${safe}_${String(Date.parse(runAt))}`;
}
