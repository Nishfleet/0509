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
  const health = sweepHealth({ failed: run.failed + run.skippedTargets, attempted: run.targets, missed: run.missed });
  if (health.state === "ok") return health;
  const lost = [`${String(run.failed)} failed`, `${String(run.skippedTargets)} skipped`].filter(
    (part) => !part.startsWith("0 "),
  );
  const named = run.missed.length === 0 ? "" : `: ${run.missed.join(", ")}`;
  return { state: health.state, reason: `${lost.join(" and ")} of ${String(run.targets)}${named}` };
}
