import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { checkSitePage, planSiteSweep, publishSiteChange } from "../../app/lib/site/sweep.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
  timeout: "5 minutes",
};

type PageOutcome = "failed" | "first" | "unchanged" | "changed";

export type SiteSweepOutcome = Record<PageOutcome, number> & { pages: number };

async function settle<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(JSON.stringify({
      event: "site.sweep_step_failed",
      step: label,
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}

export class SiteSweep extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<SiteSweepOutcome> {
    const tick = { instanceId: event.instanceId, plannedAt: event.timestamp.toISOString() };
    const targets = await step.do("plan", RETRY, () => planSiteSweep(tick.plannedAt));

    const outcomes = await targets.reduce<Promise<readonly PageOutcome[]>>(async (done, target) => {
      const previous = await done;
      const checkLabel = `check ${target.pageId}`;
      const checked = await settle(checkLabel, () =>
        step.do(checkLabel, RETRY, () => checkSitePage(target, tick)),
      );
      if (checked === null) return [...previous, "failed"];
      if (checked.outcome !== "changed") return [...previous, checked.outcome];
      const publishLabel = `publish ${target.pageId}`;
      const published = await settle(publishLabel, () =>
        step.do(publishLabel, RETRY, () => publishSiteChange(target, checked)),
      );
      return [...previous, published === null ? "failed" : "changed"];
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
