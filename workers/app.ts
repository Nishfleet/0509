import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";

export { IdentityTailWorkflow } from "./identity-tail-workflow";

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
} satisfies ExportedHandler<Env>;
