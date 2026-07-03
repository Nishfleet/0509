import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import type { AppEnv } from "../app/lib/env.server";
import {
  buildMonitoringWorkflowCapacitySleepStepName,
  buildMonitoringWorkflowConcurrencyStepName,
  claimMonitoringConcurrencySlot,
  MONITORING_CONCURRENCY_WAIT_MAX_ROUNDS,
  MONITORING_WORKFLOW_SCAN_TIMEOUT_MS,
  releaseMonitoringConcurrencySlot,
  resolveMonitoringConcurrencySlotLeaseMs,
  resolveMonitoringFanoutMode,
  type MonitoringWorkflowParams,
} from "../app/lib/monitoring-fanout.server";
import { preflightWatchlistWorkflowJob, runWatchlistWorkflowJob } from "../app/lib/monitoring.server";

class NonRetryableError extends Error {
  name = "NonRetryableError";
}

function concurrencySleepDuration(waitRound: number) {
  if (waitRound < 10) {
    return "30 seconds";
  }
  if (waitRound < 40) {
    return "60 seconds";
  }
  return "2 minutes";
}

export class MonitoringWorkflow extends WorkflowEntrypoint<AppEnv, MonitoringWorkflowParams> {
  async run(event: WorkflowEvent<MonitoringWorkflowParams>, step: WorkflowStep) {
    if (resolveMonitoringFanoutMode(this.env) === "inline") {
      return {
        status: "cancelled" as const,
        reason: "fanout_disabled",
        watchlistId: event.payload.watchlistId,
        runId: event.payload.runId,
      };
    }

    const preflight = await step.do("preflight-watchlist-monitoring", async () =>
      preflightWatchlistWorkflowJob(this.env, event.payload),
    );
    if (preflight.status !== "ready") {
      return preflight;
    }

    let permitToken: string | undefined;
    for (let waitRound = 0; waitRound < MONITORING_CONCURRENCY_WAIT_MAX_ROUNDS; waitRound += 1) {
      if (resolveMonitoringFanoutMode(this.env) === "inline") {
        throw new NonRetryableError("fanout_disabled");
      }

      const claim = await step.do(buildMonitoringWorkflowConcurrencyStepName(waitRound), async () =>
        claimMonitoringConcurrencySlot(this.env, {
          runId: event.payload.runId,
          leaseMs: resolveMonitoringConcurrencySlotLeaseMs(this.env),
        }),
      );

      if (claim.claimed) {
        permitToken = claim.token;
        break;
      }

      await step.sleep(
        buildMonitoringWorkflowCapacitySleepStepName(waitRound),
        concurrencySleepDuration(waitRound),
      );
    }

    if (!permitToken) {
      throw new NonRetryableError("concurrency_wait_exhausted");
    }

    try {
      return await step.do(
        "run-watchlist-monitoring",
        {
          timeout: `${Math.floor(MONITORING_WORKFLOW_SCAN_TIMEOUT_MS / 60_000)} minutes`,
          retries: {
            limit: 3,
            delay: "2 minutes",
            backoff: "exponential",
          },
        },
        async () =>
          runWatchlistWorkflowJob(this.env, event.payload, {
            concurrencyPermitToken: permitToken!,
          }),
      );
    } finally {
      await step.do("release-monitoring-concurrency", async () => {
        await releaseMonitoringConcurrencySlot(this.env, { token: permitToken! });
      });
    }
  }
}
