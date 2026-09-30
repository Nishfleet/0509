import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { captureException, instrumentWorkflowWithSentry, setTag, withMonitor, withSentry } from "@sentry/cloudflare";
import { createRequestHandler } from "react-router";

import { requestContext } from "../app/lib/agent/context.server";
import { createOAuthProvider } from "../app/lib/agent/oauth.server";
import { deleteExpiredAuthRows } from "../app/lib/data/auth_expiry.server";
import { stampFirstSignals } from "../app/lib/data/onboarding_run.server";
import { startNightlyDiscovery, startWeeklyRefresh, WEEKLY_REFRESH_CRON } from "../app/lib/discovery/start.server";
import { assertWorkerEnv, WorkerEnvError, workerEnvFailureResponse } from "../app/lib/env.server";
import { pingLiveness } from "../app/lib/liveness-ping.server";
import { cronMonitor } from "./cron-monitors";
import { handleBatch } from "./delivery/consumer";
import { handleDlqBatch } from "./delivery/dlq-consumer";
import { NIGHTLY_CRON, sweepPending } from "./delivery/sweeper";
import { sentryOptions } from "./sentry";
import { runNightlyStanding } from "./standing/nightly";
import { IdentityTail } from "./identity-tail-workflow";
import {
  FETCH_SWEEP_DLQ,
  FETCH_SWEEP_QUEUE,
  handleFetchSweepBatch,
  handleFetchSweepDlqBatch,
} from "./sources/fetch-sweep-consumer";
import { AccountDelete } from "./workflows/account-delete";
import { Discovery } from "./workflows/discovery";
import { HiringSweep } from "./workflows/hiring-sweep";
import { OwnSiteCheck } from "./workflows/own-site-check";
import { SiteSweep } from "./workflows/site-sweep";
import { SnapshotBackup } from "./workflows/snapshot-backup";
import { MentionsSweep } from "./workflows/mentions";
import { StandingRollover } from "./workflows/standing-rollover";

type WorkerEnv = Env & { SENTRY_DSN?: string; LIVENESS_PING_URL?: string };
type OAuthEnv = WorkerEnv & { OAUTH_PROVIDER?: OAuthHelpers };

const requestHandler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

const oauth = createOAuthProvider<OAuthEnv>({
  apiHandler: {
    fetch: (request, env, ctx) => requestHandler(request, requestContext(env.OAUTH_PROVIDER, ctx, ctx.props)),
  },
  defaultHandler: {
    fetch: (request, env, ctx) => requestHandler(request, requestContext(env.OAUTH_PROVIDER, ctx)),
  },
});

const handler = {
  async fetch(request, env, ctx) {
    try {
      assertWorkerEnv();
    } catch (error) {
      if (error instanceof WorkerEnvError) return workerEnvFailureResponse(error);
      throw error;
    }
    return oauth.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    setTag("cron", controller.cron);
    const run = async () => {
      if (controller.cron === NIGHTLY_CRON) {
        const now = new Date(controller.scheduledTime);
        const results = await Promise.allSettled([
          runNightlyStanding(env, now),
          sweepPending(env, now),
          startNightlyDiscovery(now),
          deleteExpiredAuthRows(env.DB, now),
          stampFirstSignals(),
        ]);
        results.forEach((result) => {
          if (result.status === "rejected") captureException(result.reason);
        });
        return;
      }
      if (controller.cron === WEEKLY_REFRESH_CRON) {
        await startWeeklyRefresh(new Date(controller.scheduledTime));
        return;
      }
      const ping = pingLiveness(env.LIVENESS_PING_URL);
      if (ping) ctx.waitUntil(ping);
    };
    const monitor = cronMonitor(controller.cron);
    if (!monitor) {
      await run();
      return;
    }
    await withMonitor(monitor.slug, run, {
      schedule: { type: "crontab", value: monitor.schedule },
      checkinMargin: monitor.checkinMargin,
      maxRuntime: monitor.maxRuntime,
      timezone: "UTC",
    });
  },

  async queue(batch: MessageBatch, env: Env) {
    setTag("queue", batch.queue);
    if (batch.queue === "send-email-dlq") {
      await handleDlqBatch(env, batch);
      return;
    }
    if (batch.queue === FETCH_SWEEP_DLQ) {
      handleFetchSweepDlqBatch(batch);
      return;
    }
    if (batch.queue === FETCH_SWEEP_QUEUE) {
      await handleFetchSweepBatch(batch);
      return;
    }
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<WorkerEnv>;

export { BrowserBudget } from "./budget-counter";

export { FixtureState } from "./fixture-site";

export class StandingRolloverWorkflow extends instrumentWorkflowWithSentry(sentryOptions, StandingRollover) {}

export class AccountDeleteWorkflow extends instrumentWorkflowWithSentry(sentryOptions, AccountDelete) {}

export class DiscoveryWorkflow extends instrumentWorkflowWithSentry(sentryOptions, Discovery) {}

export class IdentityTailWorkflow extends instrumentWorkflowWithSentry(sentryOptions, IdentityTail) {}

export class SiteSweepWorkflow extends instrumentWorkflowWithSentry(sentryOptions, SiteSweep) {}

export class HiringSweepWorkflow extends instrumentWorkflowWithSentry(sentryOptions, HiringSweep) {}

export class SnapshotBackupWorkflow extends instrumentWorkflowWithSentry(sentryOptions, SnapshotBackup) {}

export class OwnSiteCheckWorkflow extends instrumentWorkflowWithSentry(sentryOptions, OwnSiteCheck) {}

export class MentionsWorkflow extends instrumentWorkflowWithSentry(sentryOptions, MentionsSweep) {}

export default withSentry(sentryOptions, handler);
