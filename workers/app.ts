import * as Sentry from "@sentry/cloudflare";
import { createRequestHandler } from "react-router";

import { pingLiveness } from "../app/lib/liveness-ping.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default Sentry.withSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
      httpHeaders: false,
      cookies: false,
    },
  }),
  {
    async fetch(request) {
      return requestHandler(request);
    },

    scheduled(_controller, _env, ctx) {
      const ping = pingLiveness();
      if (ping) ctx.waitUntil(ping);
    },
  } satisfies ExportedHandler<Env>,
);
