import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleSendQueue, sweepStuckSends } from "./delivery/consumer";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(controller, env, ctx) {
    // The dead-man ping: an external service alerts when the reports stop,
    // which is the one failure a Worker cannot report about itself.
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
    if (controller.cron === "0 3 * * *") {
      ctx.waitUntil(sweepStuckSends(env.DB, env.SEND_EMAIL));
    }
  },

  async queue(batch, env) {
    await handleSendQueue(batch, env);
  },
} satisfies ExportedHandler<Env>;
