import type { CloudflareOptions } from "@sentry/cloudflare";
import { instrumentWorkflowWithSentry, withSentry } from "@sentry/cloudflare";
import { createRequestHandler } from "react-router";

import { assertWorkerEnv, WorkerEnvError, workerEnvFailureResponse } from "../app/lib/env.server";
import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleBatch } from "./delivery/consumer";
import { handleDlqBatch } from "./delivery/dlq-consumer";
import { NIGHTLY_CRON, sweepPending } from "./delivery/sweeper";
import { runNightlyStanding } from "./standing/nightly";
import { OwnSiteCheck } from "./workflows/own-site-check";
import { SiteSweep } from "./workflows/site-sweep";
import { StandingRollover } from "./workflows/standing-rollover";

type WorkerEnv = Env & { SENTRY_DSN?: string; LIVENESS_PING_URL?: string };

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const handler = {
  async fetch(request) {
    try {
      assertWorkerEnv();
    } catch (error) {
      if (error instanceof WorkerEnvError) return workerEnvFailureResponse(error);
      throw error;
    }
    return requestHandler(request);
  },

  scheduled(controller, env, ctx) {
    if (controller.cron === NIGHTLY_CRON) {
      const now = new Date(controller.scheduledTime);
      ctx.waitUntil(runNightlyStanding(env, now));
      ctx.waitUntil(sweepPending(env, now));
      return;
    }
    const ping = pingLiveness(env.LIVENESS_PING_URL);
    if (ping) ctx.waitUntil(ping);
  },

  async queue(batch: MessageBatch, env: Env) {
    if (batch.queue === "send-email-dlq") {
      await handleDlqBatch(env, batch);
      return;
    }
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<WorkerEnv>;

const sentryOptions = (env: WorkerEnv): CloudflareOptions => ({
  dsn: env.SENTRY_DSN,
  sendDefaultPii: false,
  beforeBreadcrumb: () => null,
  beforeSend: (event) => ({
    ...event,
    request: event.request && {
      method: event.request.method,
      url: event.request.url?.split("?")[0],
    },
  }),
});

export class StandingRolloverWorkflow extends instrumentWorkflowWithSentry(sentryOptions, StandingRollover) {}

export class SiteSweepWorkflow extends instrumentWorkflowWithSentry(sentryOptions, SiteSweep) {}

export class OwnSiteCheckWorkflow extends instrumentWorkflowWithSentry(sentryOptions, OwnSiteCheck) {}

export default withSentry(sentryOptions, handler);
