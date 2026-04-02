/// <reference path="../.react-router/types/+server-build.d.ts" />

import { createRequestHandler } from "react-router";

import { runScheduledMonitoring } from "../app/lib/monitoring.server";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
      country: string | null;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  process.env.NODE_ENV === "development" ? "development" : "production"
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, {
      cloudflare: {
        env,
        ctx,
        country: request.headers.get("cf-ipcountry"),
      },
    });
  },
  async scheduled(controller, env, ctx) {
    const includeDigests = controller.cron.includes("MON");
    ctx.waitUntil(runScheduledMonitoring(env, { includeDigests }));
  },
} satisfies ExportedHandler<Env>;
