import type { HomeSource } from "../home-standing";
import { nextSiteSweepAt } from "../site-sweep";

export interface FirstSweepInput {
  now: Date;
  sources: readonly HomeSource[];
}

export function firstSiteSweepAt(input: FirstSweepInput): Date | null {
  const sweepScheduled = input.sources.some((source) => source.kind === "site");
  if (!sweepScheduled) return null;
  return nextSiteSweepAt(input.now);
}
