import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import type { TargetOutcome } from "../mentions/sweep";
import { PACED_PLUGINS, planTargets, sweepTarget } from "../mentions/sweep";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
};

const PACE = "6 seconds";

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
    const outcomes: (TargetOutcome | null)[] = [];
    for (const [index, target] of targets.entries()) {
      try {
        outcomes.push(
          await step.do(`sweep ${target.pluginKey} ${target.query}`, RETRY, () =>
            sweepTarget(target, now),
          ),
        );
      } catch (error) {
        console.error(
          JSON.stringify({ event: "mentions.target_failed", source: target.pluginKey, message: String(error) }),
        );
        outcomes.push(null);
      }
      if (PACED_PLUGINS.has(target.pluginKey) && index < targets.length - 1) {
        await step.sleep(`pace ${String(index)}`, PACE);
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
