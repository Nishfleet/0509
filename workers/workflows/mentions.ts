import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { readCanarySources } from "../../app/lib/data/source.server";
import { runCanary } from "../mentions/canary";
import type { TargetOutcome } from "../mentions/sweep";
import { planTargets, sweepTarget } from "../mentions/sweep";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
};

export interface MentionsOutcome {
  targets: number;
  swept: number;
  failed: number;
  stored: number;
  unjudged: number;
}

export class MentionsSweep extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<MentionsOutcome> {
    const now = event.timestamp.toISOString();
    const targets = await step.do("plan", RETRY, () => planTargets());
    const canarySources = await step.do("canary plan", RETRY, () => readCanarySources());
    const canaryEntries: [string, number][] = [];
    for (const source of canarySources) {
      canaryEntries.push([
        source.id,
        await step.do(`canary ${source.pluginKey}`, RETRY, () => runCanary(source, now)),
      ]);
      if (source.minIntervalSeconds > 0) {
        await step.sleep(`pace canary ${source.pluginKey}`, `${source.minIntervalSeconds} seconds`);
      }
    }
    const counts = new Map<string, number>(canaryEntries);
    const outcomes: (TargetOutcome | null)[] = [];
    for (const [index, target] of targets.entries()) {
      try {
        outcomes.push(
          await step.do(`sweep ${target.pluginKey} ${target.query}`, RETRY, () =>
            sweepTarget(target, now, counts.get(target.sourceId) ?? null),
          ),
        );
      } catch (error) {
        console.error(
          JSON.stringify({ event: "mentions.target_failed", source: target.pluginKey, message: String(error) }),
        );
        outcomes.push(null);
      }
      if (target.minIntervalSeconds > 0 && index < targets.length - 1) {
        await step.sleep(`pace ${String(index)}`, `${target.minIntervalSeconds} seconds`);
      }
    }
    const done = outcomes.filter((outcome): outcome is TargetOutcome => outcome !== null);
    const result = {
      targets: targets.length,
      swept: done.length,
      failed: outcomes.length - done.length,
      stored: done.reduce((sum, outcome) => sum + outcome.stored, 0),
      unjudged: done.reduce((sum, outcome) => sum + outcome.unjudged, 0),
    };
    console.log(JSON.stringify({ event: "mentions.sweep", ...result }));
    return result;
  }
}
