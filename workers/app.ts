import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { runNightly } from "./standing/nightly";

export { StandingRolloverWorkflow } from "./workflows/standing-rollover";

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
    if (controller.cron !== "0 3 * * *") return;
    ctx.waitUntil(runNightly({ DB: env.DB, STANDING_ROLLOVER: env.STANDING_ROLLOVER }));
  },
} satisfies ExportedHandler<Env>;
