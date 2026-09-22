import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import { assertBrowserCap } from "./ads-cap";
import {
  assertCoverage,
  escalateCoverage,
  enqueueSweep,
  selectSweepWatches,
  watchesForIds,
} from "./ads-sweep";

interface SweepParams {
  tick: string;
}

const STEP = {
  retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
  timeout: "1 minute",
} as const;

export class AdsSweepWorkflow extends WorkflowEntrypoint<Env, SweepParams> {
  override async run(event: WorkflowEvent<SweepParams>, step: WorkflowStep) {
    assertBrowserCap(
      Number(this.env.PAGE_SWEEP_MAX_CONCURRENCY),
      Number(this.env.BROWSER_CONCURRENCY_CAP),
    );
    const tick = event.payload.tick;
    const queues = { page: this.env.PAGE_SWEEP, fetch: this.env.FETCH_SWEEP };

    const selected = await step.do("select", STEP, async () => {
      const selection = await selectSweepWatches(this.env.DB);
      return {
        ids: selection.watches.map((watch) => watch.watchId),
        invalid: selection.invalid,
        startedAt: Date.now(),
      };
    });

    const enqueued = await step.do("enqueue", STEP, async () => {
      const watches = await watchesForIds(this.env.DB, selected.ids);
      return enqueueSweep(watches, tick, 0, queues);
    });

    await step.sleep("settle", "30 minutes");

    const asserted = await step.do("assert", STEP, async () => {
      const watches = await watchesForIds(this.env.DB, selected.ids);
      return assertCoverage(this.env.DB, watches, tick, queues);
    });

    const escalated = await step.do("escalate", STEP, async () => {
      const watches = await watchesForIds(this.env.DB, selected.ids);
      const measuredMs = Date.now() - selected.startedAt;
      return escalateCoverage(
        this.env.DB,
        this.env.CARD_ARTIFACTS,
        tick,
        watches,
        measuredMs,
        asserted.retried,
        selected.invalid,
      );
    });

    return {
      tick,
      selected: selected.ids.length,
      enqueuedPage: enqueued.page,
      enqueuedFetch: enqueued.fetch,
      covered: asserted.covered,
      retried: asserted.retried,
      degraded: escalated.degradedSourceIds.length,
      measuredMs: escalated.measuredMs,
    };
  }
}
