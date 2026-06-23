import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import type { AppEnv } from "../app/lib/env.server";
import { type MonitoringWorkflowParams } from "../app/lib/monitoring-fanout.server";
import { runWatchlistWorkflowJob } from "../app/lib/monitoring.server";

export class MonitoringWorkflow extends WorkflowEntrypoint<AppEnv, MonitoringWorkflowParams> {
  async run(event: WorkflowEvent<MonitoringWorkflowParams>, step: WorkflowStep) {
    await step.do("wait for monitoring concurrency", async () => {
      const { acquireMonitoringConcurrencySlot } = await import("../app/lib/monitoring-fanout.server");
      const acquired = await acquireMonitoringConcurrencySlot(this.env);
      if (!acquired) {
        throw new Error("concurrency_limited");
      }
    });

    return step.do("run watchlist monitoring", async () => {
      return runWatchlistWorkflowJob(this.env, event.payload);
    });
  }
}
