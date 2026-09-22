import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleBatch } from "./delivery/consumer";
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
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
    if (controller.cron !== "0 3 * * *") return;
    ctx.waitUntil(runNightly({ DB: env.DB, STANDING_ROLLOVER: env.STANDING_ROLLOVER }));
  },

  async queue(batch: MessageBatch, env: Env) {
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<Env>;
