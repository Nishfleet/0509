import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import {
  enqueueFirstSweep,
  persistTail,
  seedTailWatches,
  startTailDiscovery,
} from "../app/lib/identity/tail.server";
import type { IdentityTailOutcome, IdentityTailParams } from "../app/lib/identity/tail.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
};

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
      };
    }
    const entityId = persisted.entityId;
    const watches = await step.do("seed-watches", RETRY, () =>
      seedTailWatches(params, event.timestamp.toISOString()),
    );
    const discoveryInstanceId = await step.do("start-discovery", RETRY, () =>
      startTailDiscovery(params.workspaceId, event.timestamp),
    );
    const queued = await step.do("enqueue-first-sweep", RETRY, () => enqueueFirstSweep(entityId, watches));
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
    };
  }
}
