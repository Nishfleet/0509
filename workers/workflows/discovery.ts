import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { readBacklog, writeBacklog } from "../../app/lib/data/discovery_backlog.server";
import { readDiscoveryContext, readRefreshTargets } from "../../app/lib/data/entity.server";
import { writeDiscoveryResults } from "../../app/lib/data/suggestion.server";
import { generateShortlist, judgeCandidates, resolveShortlist } from "../../app/lib/discovery/run.server";
import {
  judgeStillCompetitors,
  stillCompetitorAction,
  writeStillCompetitorResults,
} from "../../app/lib/discovery/refresh.server";
import type { DiscoveryParams } from "../../app/lib/discovery/start.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
};

export interface DiscoveryOutcome {
  workspaceId: string;
  shortlisted: number;
  queued: number;
  promoted: number;
  written: number;
  judged: number;
}

export class Discovery extends WorkflowEntrypoint<Env, DiscoveryParams> {
  async run(event: WorkflowEvent<DiscoveryParams>, step: WorkflowStep): Promise<DiscoveryOutcome> {
    const { workspaceId } = event.payload;
    const context = await step.do("load", RETRY, () => readDiscoveryContext(workspaceId));
    if (context === null) {
      return { workspaceId, shortlisted: 0, queued: 0, promoted: 0, written: 0, judged: 0 };
    }

    if (event.payload.mode === "refresh") {
      const now = event.timestamp.toISOString();
      const targets = await step.do("refresh-targets", RETRY, () => readRefreshTargets(workspaceId));
      const results = await step.do("refresh-judge", RETRY, () =>
        judgeStillCompetitors(context, targets, now),
      );
      await step.do("refresh-write", RETRY, () => writeStillCompetitorResults(workspaceId, results, now));
      const judged = results.filter((result) => result.verdict !== null).length;
      const retired = results.filter((result) => stillCompetitorAction(result) === "retire").length;
      const asked = results.filter((result) => stillCompetitorAction(result) === "ask").length;
      console.log(
        JSON.stringify({ event: "discovery.refresh", workspaceId, judged, retired, asked }),
      );
      return { workspaceId, shortlisted: 0, queued: 0, promoted: 0, written: 0, judged };
    }

    const backlog = await step.do("backlog", RETRY, () => readBacklog(workspaceId));
    const generated = await step.do("generate", RETRY, () => generateShortlist(context.self, backlog));
    const shortlisted = generated.shortlisted;
    const resolved = await step.do("resolve", RETRY, () => resolveShortlist(context, shortlisted));
    const results = await step.do("judge", RETRY, () => judgeCandidates(context, resolved));
    await step.do("write", RETRY, () =>
      writeDiscoveryResults(workspaceId, results, new Date().toISOString()),
    );
    await step.do("queue", RETRY, () =>
      writeBacklog(workspaceId, generated.rest, generated.promoted, new Date().toISOString()),
    );

    const outcome = {
      workspaceId,
      shortlisted: shortlisted.length,
      queued: generated.rest.length,
      promoted: generated.promoted.length,
      written: results.length,
      judged: results.filter((result) => result.verdict !== null).length,
    };
    console.log(JSON.stringify({ event: "discovery.run", ...outcome }));
    return outcome;
  }
}
