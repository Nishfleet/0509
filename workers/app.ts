/// <reference path="../.react-router/types/+server-build.d.ts" />

import { createRequestHandler } from "react-router";

import {
  runScheduledDiscoveryWarmup,
  runScheduledMonitoring,
} from "../app/lib/monitoring.server";
import {
  isPublicMarkdownPage,
  LLMS_TEXT,
  PUBLIC_MARKDOWN,
  wantsPublicMarkdown,
} from "../app/lib/public-markdown";
import { publicSeoFileForPathname } from "../app/lib/seo";
import { enforceRequestRateLimit } from "../app/lib/rate-limit.server";
import { resolveScheduledTask } from "./schedule";
import { withSecurityHeaders } from "./security-headers";
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

function markdownResponse(request: Request, body: string): Response {
  return withSecurityHeaders(
    new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "vary": "Accept",
        "content-signal": "search=yes, ai-input=yes",
      },
    }),
  );
}

function publicFileResponse(request: Request, file: NonNullable<ReturnType<typeof publicSeoFileForPathname>>): Response {
  return withSecurityHeaders(
    new Response(request.method === "HEAD" ? null : file.body, {
      headers: {
        "content-type": file.contentType,
        "cache-control": file.cacheControl,
      },
    }),
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const publicSeoFile = publicSeoFileForPathname(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && publicSeoFile) {
      return publicFileResponse(request, publicSeoFile);
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/llms.txt") {
      return markdownResponse(request, LLMS_TEXT);
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      wantsPublicMarkdown(request) &&
      isPublicMarkdownPage(url.pathname)
    ) {
      return markdownResponse(request, PUBLIC_MARKDOWN);
    }

    const rateLimitResponse = await enforceRequestRateLimit(request, env, ctx);
    if (rateLimitResponse) {
      return withSecurityHeaders(rateLimitResponse);
    }

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
        includeScans: scheduledTask.includeScans,
        includeDigests: scheduledTask.includeDigests,
        digestCadence: scheduledTask.digestCadence,
        digestLookbackDays: scheduledTask.digestLookbackDays,
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      }).then(
        (result) => {
          console.log("scheduled monitoring completed", {
            cron: controller.cron,
            ...result,
          });
        },
        (error) => {
          console.error("scheduled monitoring run failed", {
            cron: controller.cron,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
