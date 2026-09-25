import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { startDiscovery } from "../app/lib/discovery/start.server";
import { attemptSiteFill, markSiteFill, siteWasReached } from "../app/lib/identity/site-fill.server";
import {
  enqueueFirstSweep,
  persistTail,
  seedTailWatches,
} from "../app/lib/identity/tail.server";
import type { IdentityTailOutcome, IdentityTailParams } from "../app/lib/identity/tail.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
};

const SITE_FILL_ATTEMPTS = 24;
const SITE_FILL_WAIT = "1 hour";

export class IdentityTail extends WorkflowEntrypoint<Env, IdentityTailParams> {
  async run(event: WorkflowEvent<IdentityTailParams>, step: WorkflowStep): Promise<IdentityTailOutcome> {
    const params = event.payload;
    const persisted = await step.do("persist", RETRY, () => persistTail(params));
    if (persisted.entityId === null) {
      return {
        entityId: params.entityId,
        watches: [],
        discoveryInstanceId: null,
        queued: [],
        r2Keys: [],
        siteFill: null,
      };
    }
    const entityId = persisted.entityId;
    const watches = await step.do("seed-watches", RETRY, () =>
      seedTailWatches(params, event.timestamp.toISOString()),
    );
    const discoveryInstanceId = await step.do("start-discovery", RETRY, () =>
      startDiscovery(params.workspaceId, event.timestamp),
    );
    const queued = await step.do("enqueue-first-sweep", RETRY, () => enqueueFirstSweep(entityId, watches));
    const siteFill =
      params.homepageUrl === null ? null : await this.fillSite(step, entityId, params.homepageUrl);
    return {
      entityId,
      watches: watches.map((watch) => ({
        id: watch.id,
        sourceKey: watch.sourceKey,
        targetKey: watch.targetKey,
      })),
      discoveryInstanceId,
      queued,
      r2Keys: [],
      siteFill,
    };
  }

  private async fillSite(
    step: WorkflowStep,
    entityId: string,
    homepageUrl: string,
  ): Promise<"filled" | "gave_up" | null> {
    const reached = await step.do("site-reached", RETRY, () => siteWasReached(homepageUrl));
    if (reached) return null;
    await step.do("site-fill-pending", RETRY, () => markSiteFill(entityId, "pending"));
    for (let attempt = 1; attempt <= SITE_FILL_ATTEMPTS; attempt += 1) {
      await step.sleep(`site-fill-wait-${String(attempt)}`, SITE_FILL_WAIT);
      const result = await step.do(`site-fill-${String(attempt)}`, RETRY, () =>
        attemptSiteFill(entityId, homepageUrl),
      );
      if (result === "filled") return "filled";
    }
    await step.do("site-fill-gave-up", RETRY, () => markSiteFill(entityId, "gave_up"));
    return "gave_up";
  }
}
