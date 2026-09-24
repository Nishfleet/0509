import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { checkSitePage, planSiteSweep, publishSiteChange } from "../../app/lib/site/sweep.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

type PageOutcome = "failed" | "first" | "unchanged" | "changed";

export type SiteSweepOutcome = Record<PageOutcome, number> & { pages: number };

export class SiteSweep extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<SiteSweepOutcome> {
    const plannedAt = event.timestamp.toISOString();
    const targets = await step.do("plan", RETRY, () => planSiteSweep(plannedAt));

    const outcomes = await targets.reduce<Promise<readonly PageOutcome[]>>(async (done, target) => {
      const previous = await done;
      const checked = await step.do(`check ${target.pageId}`, RETRY, () => checkSitePage(target));
      if (checked.outcome === "changed") {
        await step.do(`publish ${target.pageId}`, RETRY, () => publishSiteChange(target, checked));
      }
      return [...previous, checked.outcome];
    }, Promise.resolve([]));

    const count = (outcome: PageOutcome) => outcomes.filter((o) => o === outcome).length;
    const summary: SiteSweepOutcome = {
      pages: outcomes.length,
      failed: count("failed"),
      first: count("first"),
      unchanged: count("unchanged"),
      changed: count("changed"),
    };
    console.log(JSON.stringify({ event: "site.sweep", ...summary }));
    return summary;
  }
}
