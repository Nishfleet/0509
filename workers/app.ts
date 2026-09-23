import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleBatch } from "./delivery/consumer";
import { handleDlqBatch } from "./delivery/dlq-consumer";
import { NIGHTLY_CRON, sweepPending } from "./delivery/sweeper";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(controller, env, ctx) {
    if (controller.cron === NIGHTLY_CRON) {
      ctx.waitUntil(sweepPending(env, new Date(controller.scheduledTime)));
      return;
    }
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
  },

  async queue(batch: MessageBatch, env: Env) {
    if (batch.queue === "send-email-dlq") {
      await handleDlqBatch(env, batch);
      return;
    }
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<Env>;
