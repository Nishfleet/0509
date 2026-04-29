/// <reference path="../.react-router/types/+server-build.d.ts" />

import { createRequestHandler } from "react-router";

import {
  runScheduledDiscoveryWarmup,
  runScheduledMonitoring,
} from "../app/lib/monitoring.server";
import { resolveScheduledTask } from "./schedule";
export { MonitoringWorkflow } from "./monitoring-workflow";

type GlobalEnvCarrier = typeof globalThis & {
  __APP_REQUEST_ENV__?: Env;
};

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

// Baseline security headers applied to every response. CSP allows Google Fonts
// (used in app/root.tsx) and inline <script>/<style> emitted by React Router's
// <Scripts /> / <Links /> during SSR hydration. Tighten to nonces in a follow-up.
const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

function withSecurityHeaders(response: Response): Response {
  // Clone headers so we don't mutate a potentially-immutable response.
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    (globalThis as GlobalEnvCarrier).__APP_REQUEST_ENV__ = env;
    const response = await requestHandler(request, {
      cloudflare: {
        env,
        ctx,
        country: request.headers.get("cf-ipcountry"),
      },
    });
    return withSecurityHeaders(response);
  },
  async scheduled(controller, env, ctx) {
    const scheduledTask = resolveScheduledTask(controller.cron);

    if (scheduledTask.kind === "discovery_warmup") {
      ctx.waitUntil(runScheduledDiscoveryWarmup(env));
      return;
    }

    ctx.waitUntil(
      runScheduledMonitoring(env, {
        includeDigests: scheduledTask.includeDigests,
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      }),
    );
  },
} satisfies ExportedHandler<Env>;
