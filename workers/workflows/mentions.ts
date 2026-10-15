import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";
import { captureException } from "@sentry/cloudflare";

import { MENTIONS_SWEEP_CRON, sweepMonitor } from "../../app/lib/cadence";
import { readCanarySources } from "../../app/lib/data/source.server";
import { runCanary } from "../mentions/canary";
import type { Streaks } from "../mentions/retry";
import { deferred, retrySkipped, sustainedSkips, track, tripped } from "../mentions/retry";
import type { MentionTarget, TargetOutcome } from "../mentions/sweep";
import { planTargets, sweepTarget } from "../mentions/sweep";
import { sweepHealth } from "../../app/lib/sweep-health";
import { isNativeSchedule } from "../workflow-crons";
import { withStepCheckIn } from "../workflow-monitor";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
};

const MONITOR = { ...sweepMonitor(MENTIONS_SWEEP_CRON), timezone: "UTC" } as const;

export interface MentionsOutcome {
  targets: number;
  swept: number;
  failed: number;
  missed: string[];
  stored: number;
  unjudged: number;
  skipped: number;
}

export class MentionsSweep extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<MentionsOutcome | null> {
    if (isNativeSchedule(event)) return null;
    return withStepCheckIn(
      step,
      {
        slug: "mentions-sweep",
        config: MONITOR,
        health: (outcome) =>
          sweepHealth({ failed: outcome.failed, attempted: outcome.targets, missed: outcome.missed }),
      },
      () => this.runMentions(event, step),
    );
  }

  private async runMentions(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<MentionsOutcome> {
    const now = event.timestamp.toISOString();
    const targets = await step.do("plan", RETRY, () => planTargets());
    const counts = await this.canaries(step, now);
    const run = (target: MentionTarget) => sweepTarget(target, now, counts.get(target.sourceId) ?? null);
    const outcomes = await this.firstPass(step, targets, run);
    const settled = await retrySkipped(step, { targets, outcomes, run });
    for (const entry of sustainedSkips({ targets, outcomes: settled, run })) {
      const message = JSON.stringify({ event: "mentions.sustained_skips", ...entry });
      console.error(message);
      captureException(new Error(message), { tags: { lane: "mentions", source: entry.pluginKey } });
    }
    const done = settled.filter((outcome): outcome is TargetOutcome => outcome !== null);
    const result = {
      targets: targets.length,
      swept: done.length,
      failed: settled.length - done.length,
      missed: [...new Set(targets.flatMap((target, index) => (settled[index] === null ? [target.pluginKey] : [])))],
      stored: done.reduce((sum, outcome) => sum + outcome.stored, 0),
      unjudged: done.reduce((sum, outcome) => sum + outcome.unjudged, 0),
      skipped: done.reduce((sum, outcome) => sum + outcome.skipped, 0),
    };
    console.warn(JSON.stringify({ event: "mentions.sweep", ...result }));
    return result;
  }

  private async canaries(step: WorkflowStep, now: string): Promise<Map<string, number>> {
    const canarySources = await step.do("canary plan", RETRY, () => readCanarySources());
    const counts = new Map<string, number>();
    for (const source of canarySources) {
      const count = await step.do(`canary ${source.pluginKey}`, RETRY, () => runCanary(source, now));
      if (count !== null) counts.set(source.id, count);
      if (source.minIntervalSeconds > 0) {
        await step.sleep(`pace canary ${source.pluginKey}`, source.minIntervalSeconds * 1000);
      }
    }
    return counts;
  }

  private async firstPass(
    step: WorkflowStep,
    targets: MentionTarget[],
    run: (target: MentionTarget) => Promise<TargetOutcome>,
  ): Promise<(TargetOutcome | null)[]> {
    const outcomes: (TargetOutcome | null)[] = [];
    const streaks: Streaks = new Map();
    for (const [index, target] of targets.entries()) {
      if (tripped(streaks, target)) {
        outcomes.push(deferred(target));
        continue;
      }
      try {
        const outcome = await step.do(`sweep ${target.pluginKey} ${target.query}`, RETRY, () => run(target));
        track(streaks, target, outcome);
        outcomes.push(outcome);
      } catch (error) {
        console.error(
          JSON.stringify({ event: "mentions.target_failed", source: target.pluginKey, message: String(error) }),
        );
        outcomes.push(null);
      }
      if (target.minIntervalSeconds > 0 && index < targets.length - 1) {
        await step.sleep(`pace ${String(index)}`, target.minIntervalSeconds * 1000);
      }
    }
    return outcomes;
  }
}
