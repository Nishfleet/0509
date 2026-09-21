import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const SITE_SWEEP_CRON = "38 4 * * *";

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(controller, env, ctx) {
    // The dead-man ping: an external service alerts when the reports stop,
    // which is the one failure a Worker cannot report about itself.
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
    // The daily site sweep: a durable Workflow, so the 15-minute cron wall
    // clock never decides whether a sweep finished. The instance id is the
    // UTC date, so a retried trigger on the same day re-attaches instead of
    // double-sweeping.
    if (controller.cron === SITE_SWEEP_CRON) {
      const day = new Date().toISOString().slice(0, 10);
      ctx.waitUntil(env.SITE_SWEEP.create({ id: `site-sweep-${day}` }));
    }
  },
} satisfies ExportedHandler<Env>;

export { SiteSweepWorkflow } from "./site-sweep";
