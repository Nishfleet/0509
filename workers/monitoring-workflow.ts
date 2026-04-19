import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import type { AppEnv } from "../app/lib/env.server";
import {
  runWatchlistWorkflowJob,
  type MonitoringWorkflowParams,
} from "../app/lib/monitoring.server";

export class MonitoringWorkflow extends WorkflowEntrypoint<AppEnv, MonitoringWorkflowParams> {
  async run(event: WorkflowEvent<MonitoringWorkflowParams>, step: WorkflowStep) {
    return step.do("run watchlist monitoring", async () => {
      return runWatchlistWorkflowJob(this.env, event.payload);
    });
  }
}
