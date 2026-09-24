import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { readDiscoveryContext } from "../../app/lib/data/entity.server";
import { writeDiscoveryResults } from "../../app/lib/data/suggestion.server";
import { generateShortlist, judgeCandidates, resolveShortlist } from "../../app/lib/discovery/run.server";
import type { DiscoveryParams } from "../../app/lib/discovery/start.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
};

export interface DiscoveryOutcome {
  workspaceId: string;
  shortlisted: number;
  written: number;
  judged: number;
}

export class Discovery extends WorkflowEntrypoint<Env, DiscoveryParams> {
  async run(event: WorkflowEvent<DiscoveryParams>, step: WorkflowStep): Promise<DiscoveryOutcome> {
    const { workspaceId } = event.payload;
    const context = await step.do("load", RETRY, () => readDiscoveryContext(workspaceId));
    if (context === null) return { workspaceId, shortlisted: 0, written: 0, judged: 0 };

    const shortlisted = await step.do("generate", RETRY, () => generateShortlist(context.self));
    const resolved = await step.do("resolve", RETRY, () => resolveShortlist(context, shortlisted));
    const results = await step.do("judge", RETRY, () => judgeCandidates(context, resolved));
    await step.do("write", RETRY, () => writeDiscoveryResults(workspaceId, results, new Date().toISOString()));

    const outcome = {
      workspaceId,
      shortlisted: shortlisted.length,
      written: results.length,
      judged: results.filter((result) => result.verdict !== null).length,
    };
    console.log(JSON.stringify({ event: "discovery.run", ...outcome }));
    return outcome;
  }
}
