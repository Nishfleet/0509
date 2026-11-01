import { nextSiteSweepAt, siteSweepWindowEnd } from "../cadence";
import type { HomeSource } from "../home-standing";

export interface FirstSweepInput {
  now: Date;
  sources: readonly HomeSource[];
  brandsOn: number;
}

export interface FirstSweepWindow {
  startsAt: Date;
  endsAt: Date;
}

export function firstSiteSweepWindow(input: FirstSweepInput): FirstSweepWindow | null {
  const sweepScheduled = input.brandsOn > 0 || input.sources.some((source) => source.kind === "site");
  if (!sweepScheduled) return null;
  const startsAt = nextSiteSweepAt(input.now);
  return { startsAt, endsAt: siteSweepWindowEnd(startsAt) };
}

export function firstSiteSweepAt(input: FirstSweepInput): Date | null {
  return firstSiteSweepWindow(input)?.endsAt ?? null;
}
