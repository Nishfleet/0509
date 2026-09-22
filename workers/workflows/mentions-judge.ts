import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { judgeBatch, listDedupKeys } from "../mentions/judge";

interface Params { snapshotId: string }

const STEP = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
  timeout: "30 minutes",
} as const;

export class MentionsJudgeWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const indexed = await step.do("index", STEP, async () => {
      const dedupKeys = await listDedupKeys(this.env, event.payload.snapshotId);
      return { dedupKeys };
    });
    const verdictIds: string[] = [];
    const signalIds: string[] = [];
    for (let index = 0; index < indexed.dedupKeys.length; index += 10) {
      const slice = indexed.dedupKeys.slice(index, index + 10);
      const judged = await step.do(`judge-${String(index)}`, STEP, async () =>
        judgeBatch(this.env, event.payload.snapshotId, slice),
      );
      verdictIds.push(...judged.verdictIds);
      signalIds.push(...judged.signalIds);
    }
    return { verdictIds, signalIds };
  }
}
