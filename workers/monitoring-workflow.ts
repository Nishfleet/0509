import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

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
  type ScheduledMonitoringWorkflowParams,
} from "../app/lib/monitoring-fanout.server";
import {
  preflightWatchlistWorkflowJob,
  runFirstWatchlistScanWorkflowJob,
  runWatchlistWorkflowJob,
  type FirstWatchlistScanWorkflowParams,
} from "../app/lib/monitoring.server";

// LIVE in production when wrangler.jsonc sets MONITORING_FANOUT_MODE=fanout
// (with MONITORING_FANOUT_GLOBAL=1). Do not delete this as "dead code" — the
// inline path is only the unset-var fallback in resolveMonitoringFanoutMode().

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
    if (event.payload.kind === "first_scan") {
      const firstScanPayload = event.payload as FirstWatchlistScanWorkflowParams;
      return step.do(
        "run-first-watchlist-scan",
        {
          timeout: `${Math.floor(MONITORING_WORKFLOW_SCAN_TIMEOUT_MS / 60_000)} minutes`,
          retries: {
            // A killed worker keeps its D1 lease. The 5/10/20/40 minute
            // retry sequence reaches the first safe post-lease reclaim inside
            // the 90-minute recovery bound without overlapping a live scan.
            limit: 6,
            delay: "5 minutes",
            backoff: "exponential",
          },
        },
        async () => {
          const result = await runFirstWatchlistScanWorkflowJob(
            this.env,
            firstScanPayload,
          );
          try {
            const { ensureFirstBriefForWatchlist } = await import(
              "../app/lib/first-brief.server"
            );
            await ensureFirstBriefForWatchlist(
              this.env,
              firstScanPayload.watchlistId,
            );
          } catch {
            // First-brief filing must never fail the activation scan.
          }
          return result;
        },
      );
    }

    const scheduledPayload = event.payload as ScheduledMonitoringWorkflowParams;
    if (resolveMonitoringFanoutMode(this.env) === "inline") {
      return {
        status: "cancelled" as const,
        reason: "fanout_disabled",
        watchlistId: scheduledPayload.watchlistId,
        runId: scheduledPayload.runId,
      };
    }

    const preflight = await step.do("preflight-watchlist-monitoring", async () =>
      preflightWatchlistWorkflowJob(this.env, scheduledPayload),
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
          runId: scheduledPayload.runId,
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
          runWatchlistWorkflowJob(this.env, scheduledPayload, {
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
