import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import { WorkflowEntrypoint } from "cloudflare:workers";

import { reconcileCandidates, reconcileSubscription } from "../../app/lib/billing/reconcile.server";

const RETRY: WorkflowStepConfig = {
  retries: { limit: 3, delay: "20 seconds", backoff: "exponential" },
  timeout: "1 minute",
};

const AT_ONCE = 10;

export interface BillingReconcileParams {
  at: string;
}

async function reconcileGroup(step: WorkflowStep, ids: readonly string[]): Promise<number> {
  const failures = await Promise.all(
    ids.map((id) =>
      step
        .do(`reconcile ${id}`, RETRY, () => reconcileSubscription(id))
        .then(
          () => 0,
          () => 1,
        ),
    ),
  );
  return failures.reduce((sum, failure) => sum + failure, 0);
}

export class BillingReconcile extends WorkflowEntrypoint<Env, BillingReconcileParams> {
  async run(event: WorkflowEvent<BillingReconcileParams>, step: WorkflowStep): Promise<number> {
    const ids = await step.do("list", RETRY, () => reconcileCandidates(new Date(event.payload.at)));
    let failed = 0;
    for (let start = 0; start < ids.length; start += AT_ONCE) {
      failed += await reconcileGroup(step, ids.slice(start, start + AT_ONCE));
    }
    if (failed > 0) {
      throw new Error(`billing: reconcile failed for ${failed.toFixed(0)} of ${ids.length.toFixed(0)} subscriptions`);
    }
    return ids.length;
  }
}
