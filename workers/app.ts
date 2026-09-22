import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleBatch } from "./delivery/consumer";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(_controller, _env, ctx) {
    // The dead-man ping: an external service alerts when the reports stop,
    // which is the one failure a Worker cannot report about itself.
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
  },

  // The one send lane (0509#3979): every message the product sends goes
  // through this consumer, which claims a send before making it.
  async queue(batch: MessageBatch, env: Env) {
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<Env>;
