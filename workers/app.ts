import { withSentry } from "@sentry/cloudflare";
import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";
import { handleBatch } from "./delivery/consumer";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const handler = {
  async fetch(request) {
    return requestHandler(request);
  },

  scheduled(_controller, _env, ctx) {
    const ping = pingLiveness();
    if (ping) ctx.waitUntil(ping);
  },

  async queue(batch: MessageBatch, env: Env) {
    await handleBatch(env, batch);
  },
} satisfies ExportedHandler<Env>;

export default withSentry(
  () => ({
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
      databaseQueryData: false,
    },
  }),
  handler,
);
