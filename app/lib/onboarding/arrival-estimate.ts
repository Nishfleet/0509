import { SITE_SWEEP_ALLOWANCE_HOURS, SITE_SWEEP_UTC_HOUR } from "../cadence";
import type { HomeSource } from "../home-standing";

export function nextSiteSweepAt(now: Date): Date {
  const sweep = new Date(now.getTime());
  sweep.setUTCHours(SITE_SWEEP_UTC_HOUR, 0, 0, 0);
  if (sweep.getTime() <= now.getTime()) sweep.setUTCDate(sweep.getUTCDate() + 1);
  return sweep;
}

export interface FirstSweepInput {
  now: Date;
  sources: readonly HomeSource[];
}

export function firstSiteSweepAt(input: FirstSweepInput): Date | null {
  const sweepScheduled = input.sources.some((source) => source.kind === "site");
  if (!sweepScheduled) return null;
  const start = nextSiteSweepAt(input.now);
  return new Date(start.getTime() + SITE_SWEEP_ALLOWANCE_HOURS * 3_600_000);
}
