import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleBatch } from "./delivery/consumer";
import { DISCOVERY_REFRESH_CRON, startDiscoveryRefresh } from "./discovery-schedule";

export { DiscoveryWorkflow } from "./discovery-workflow";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(controller, env, ctx) {
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
    if (controller.cron === DISCOVERY_REFRESH_CRON) {
      ctx.waitUntil(startDiscoveryRefresh(env, controller.scheduledTime));
    }
  },

  async queue(batch: MessageBatch, env: Env) {
    if (batch.queue === "send-email") await handleBatch(env, batch);
  },
} satisfies ExportedHandler<Env>;
