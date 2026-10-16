import type { RunHealth } from "../../app/lib/sweep-health";
import { sweepHealth } from "../../app/lib/sweep-health";
import type { MentionTarget, TargetOutcome } from "./sweep";

export function skippedTargets(settled: readonly (TargetOutcome | null)[]): number {
  return settled.filter((outcome) => outcome !== null && outcome.skipped > 0).length;
}

export function lostSources(targets: readonly MentionTarget[], settled: readonly (TargetOutcome | null)[]): string[] {
  const lost = targets.flatMap((target, index) => {
    const outcome = settled[index];
    return outcome === null || (outcome?.skipped ?? 0) > 0 ? [target.pluginKey] : [];
  });
  return [...new Set(lost)];
}

export function mentionsHealth(run: {
  failed: number;
  skippedTargets: number;
  targets: number;
  missed: readonly string[];
}): RunHealth {
  return sweepHealth({ failed: run.failed + run.skippedTargets, attempted: run.targets, missed: run.missed });
}
