import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleBatch } from "./delivery/consumer";
import { runNightlyReconciliation } from "./standing/nightly";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export { TakedownWorkflow } from "./workflows/takedown";

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(controller, env, ctx) {
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);

    ctx.waitUntil(runNightlyReconciliation(env, new Date(controller.scheduledTime)));
  },

  async queue(batch: MessageBatch, env: Env) {
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<Env>;
