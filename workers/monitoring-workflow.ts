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
  FIRST_SCAN_MAX_ATTEMPTS,
  MONITORING_WORKFLOW_SCAN_TIMEOUT_MS,
  releaseMonitoringConcurrencySlot,
  resolveMonitoringConcurrencySlotLeaseMs,
  resolveMonitoringFanoutMode,
  resolveMonitoringOrchestrationMaxAgeMs,
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

// The longest capacity sleep is 2 minutes (see the last branch of
// concurrencySleepDuration below). Capping the wait at
// MONITORING_ORCHESTRATION_MAX_AGE_MS means a queued run can never keep waiting
// past the age at which the reconciler cancels it as stale.
const CONCURRENCY_WAIT_LONGEST_SLEEP_MS = 2 * 60 * 1000;

function concurrencySleepDuration(waitRound: number) {
  if (waitRound < 10) {
    return "30 seconds";
  }
  if (waitRound < 40) {
    return "60 seconds";
  }
  return "2 minutes";
}

function resolveMonitoringConcurrencyWaitMaxRounds(env: AppEnv) {
  return Math.max(
    1,
    Math.ceil(resolveMonitoringOrchestrationMaxAgeMs(env) / CONCURRENCY_WAIT_LONGEST_SLEEP_MS),
  );
}

export class MonitoringWorkflow extends WorkflowEntrypoint<AppEnv, MonitoringWorkflowParams> {
  async run(event: WorkflowEvent<MonitoringWorkflowParams>, step: WorkflowStep) {
    if (event.payload.kind === "first_scan") {
      const firstScanPayload = event.payload as FirstWatchlistScanWorkflowParams;
      if (firstScanPayload.reason === "signup_first_brief") {
        console.log(
          JSON.stringify({
            level: "info",
            operation: "first_brief_signup_capture_started",
            message: "Activation scan started for the same-session first brief",
            details: { watchlistId: firstScanPayload.watchlistId },
          }),
        );
      }
      return step.do(
        "run-first-watchlist-scan",
        {
          timeout: `${Math.floor(MONITORING_WORKFLOW_SCAN_TIMEOUT_MS / 60_000)} minutes`,
          retries: {
            // A killed worker keeps its D1 lease. The 5/10/20/40 minute
            // retry sequence reaches the first safe post-lease reclaim inside
            // the 90-minute recovery bound without overlapping a live scan.
            // limit = retries, so one initial attempt + (limit) retries =
            // FIRST_SCAN_MAX_ATTEMPTS total attempts, the D1 claim cap.
            limit: FIRST_SCAN_MAX_ATTEMPTS - 1,
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

    const maxWaitRounds = resolveMonitoringConcurrencyWaitMaxRounds(this.env);
    let permitToken: string | undefined;
    for (let waitRound = 0; waitRound < maxWaitRounds; waitRound += 1) {
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

      if ("reason" in claim && claim.reason === "run_inactive") {
        // The run finished or was stale-cancelled while this instance waited,
        // so it can never become eligible again. Stop now instead of sleeping
        // for hours on a run that is already terminal.
        return {
          status: "cancelled" as const,
          reason: "concurrency_wait_run_inactive" as const,
          watchlistId: scheduledPayload.watchlistId,
          runId: scheduledPayload.runId,
        };
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
