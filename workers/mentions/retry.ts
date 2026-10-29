import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";

import type { SweepBudget } from "./budget";
import { FAILED_TARGET_MS } from "./budget";
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
  readonly budget: SweepBudget;
}

function skippedIndexes({ targets, outcomes }: SweepPass): number[] {
  return targets.flatMap((_target, index) => ((outcomes[index]?.skipped ?? 0) > 0 ? [index] : []));
}

async function retryOne(step: WorkflowStep, pass: SweepPass, index: number): Promise<TargetOutcome | null> {
  const target = pass.targets[index];
  if (target === undefined) return null;
  try {
    const outcome = await step.do(`retry ${target.pluginKey} ${target.query}`, RETRY, () => pass.run(target));
    pass.budget.spend(outcome.ms ?? 0);
    return outcome;
  } catch {
    pass.budget.spend(FAILED_TARGET_MS);
    return pass.outcomes[index] ?? null;
  }
}

function retryable(pass: SweepPass, current: readonly (TargetOutcome | null)[]): number[] {
  return skippedIndexes({ ...pass, outcomes: current }).filter((index) => pass.targets[index] !== undefined);
}

async function retryRound(
  step: WorkflowStep,
  pass: SweepPass,
  state: { round: number; current: readonly (TargetOutcome | null)[] },
): Promise<(TargetOutcome | null)[]> {
  const { round, current } = state;
  const streaks: Streaks = new Map();
  const next = [...current];
  for (const index of retryable(pass, current)) {
    const target = pass.targets[index];
    if (target === undefined || tripped(streaks, target) || pass.budget.spent()) continue;
    const outcome = await retryOne(step, { ...pass, outcomes: current }, index);
    next[index] = outcome;
    if (outcome !== null) track(streaks, target, outcome);
    if (target.minIntervalSeconds > 0) {
      await step.sleep(`pace retry ${String(round)} ${String(index)}`, target.minIntervalSeconds * 1000);
      pass.budget.spend(target.minIntervalSeconds * 1000);
    }
  }
  return next;
}

export async function retrySkipped(step: WorkflowStep, pass: SweepPass): Promise<(TargetOutcome | null)[]> {
  let current = [...pass.outcomes];
  for (let round = 0; round < ROUNDS; round += 1) {
    if (pass.budget.spent() || retryable(pass, current).length === 0) break;
    const pauseMs = PAUSE_MS * 2 ** round;
    await step.sleep(`pause before retry round ${String(round)}`, pauseMs);
    pass.budget.spend(pauseMs);
    current = await retryRound(step, pass, { round, current });
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
