import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";

import type { MentionTarget, TargetOutcome } from "./sweep";

const PAUSE_MS = 120_000;
const ROUNDS = 3;
const MIN_SKIPPED = 3;
const TRIP_AFTER = 3;
const RETRY: WorkflowStepConfig = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
};

export type Streaks = Map<string, number>;

export function tripped(streaks: Streaks, target: MentionTarget): boolean {
  return (streaks.get(target.pluginKey) ?? 0) >= TRIP_AFTER;
}

export function track(streaks: Streaks, target: MentionTarget, outcome: TargetOutcome): void {
  streaks.set(target.pluginKey, outcome.skipped > 0 ? (streaks.get(target.pluginKey) ?? 0) + 1 : 0);
}

export function deferred(target: MentionTarget): TargetOutcome {
  return { items: 0, stored: 0, unjudged: 0, skipped: target.watches.length };
}

export interface SweepPass {
  readonly targets: readonly MentionTarget[];
  readonly outcomes: readonly (TargetOutcome | null)[];
  readonly run: (target: MentionTarget) => Promise<TargetOutcome>;
}

function skippedIndexes({ targets, outcomes }: SweepPass): number[] {
  return targets.flatMap((_target, index) => ((outcomes[index]?.skipped ?? 0) > 0 ? [index] : []));
}

async function retryOne(step: WorkflowStep, pass: SweepPass, index: number): Promise<TargetOutcome | null> {
  const target = pass.targets[index];
  if (target === undefined) return null;
  try {
    return await step.do(`retry ${target.pluginKey} ${target.query}`, RETRY, () => pass.run(target));
  } catch {
    return pass.outcomes[index] ?? null;
  }
}

export async function retrySkipped(step: WorkflowStep, pass: SweepPass): Promise<(TargetOutcome | null)[]> {
  let current = [...pass.outcomes];
  for (let round = 0; round < ROUNDS; round += 1) {
    const pending = skippedIndexes({ ...pass, outcomes: current });
    if (pending.length === 0) break;
    await step.sleep(`pause before retry round ${String(round)}`, PAUSE_MS * 2 ** round);
    const streaks: Streaks = new Map();
    const next = [...current];
    for (const index of pending) {
      const target = pass.targets[index];
      if (target === undefined || tripped(streaks, target)) continue;
      const outcome = await retryOne(step, { ...pass, outcomes: current }, index);
      next[index] = outcome;
      if (outcome !== null) track(streaks, target, outcome);
      if (target.minIntervalSeconds > 0)
        await step.sleep(`pace retry ${String(round)} ${String(index)}`, target.minIntervalSeconds * 1000);
    }
    current = next;
  }
  return current;
}

export interface SustainedSkips {
  readonly pluginKey: string;
  readonly skipped: number;
  readonly total: number;
}

export function sustainedSkips(pass: SweepPass): SustainedSkips[] {
  const skipped = new Set(skippedIndexes(pass));
  const plugins = new Set(pass.targets.map((target) => target.pluginKey));
  return [...plugins]
    .map((pluginKey) => ({
      pluginKey,
      total: pass.targets.filter((target) => target.pluginKey === pluginKey).length,
      skipped: pass.targets.filter((target, index) => target.pluginKey === pluginKey && skipped.has(index)).length,
    }))
    .filter((entry) => entry.skipped >= MIN_SKIPPED && entry.skipped * 2 >= entry.total);
}
