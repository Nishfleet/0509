/// <reference path="../.react-router/types/+server-build.d.ts" />

import { createRequestHandler } from "react-router";

import { reportScheduledTaskFailure } from "../app/lib/cron-failure-alert.server";
import {
  flushDeferredInstantAlerts,
  runScheduledDiscoveryWarmup,
  runScheduledMonitoring,
  sendCustomerAtRiskAlert,
  sendWeeklyBusinessNumbers,
} from "../app/lib/monitoring.server";
import {
  isPublicMarkdownPage,
  LLMS_TEXT,
  PUBLIC_MARKDOWN,
  wantsPublicMarkdown,
} from "../app/lib/public-markdown";
import { publicSeoFileForPathname } from "../app/lib/seo";
import { enforceRequestRateLimit } from "../app/lib/rate-limit.server";
import { runRetentionSweep } from "../app/lib/retention.server";
import { scheduleBillingLifecycleEmailRecovery } from "./delivery-recovery";
import { primaryDomainRedirect } from "./primary-domain";
import {
  resolveOperationalRiskAlertIdempotencyKey,
  resolveScheduledTask,
  WEEKLY_DIGEST_CRON,
} from "./schedule";
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
    request,
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
    request,
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const primaryDomainResponse = primaryDomainRedirect(request);
    if (primaryDomainResponse) {
      return withSecurityHeaders(primaryDomainResponse, request);
    }

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
      return withSecurityHeaders(rateLimitResponse, request);
    }

    (globalThis as GlobalEnvCarrier).__APP_REQUEST_ENV__ = env;
    const response = await requestHandler(request, {
      cloudflare: {
        env,
        ctx,
        country: request.headers.get("cf-ipcountry"),
      },
    });
    return withSecurityHeaders(response, request);
  },
  async scheduled(controller, env, ctx) {
    const scheduledTask = resolveScheduledTask(controller.cron);

    // Every cron also drains a bounded customer-email outbox. Keeping this
    // before the warmup early return ensures a worker that stopped after the
    // durable pre-dispatch claim cannot strand a finalized billing event.
    scheduleBillingLifecycleEmailRecovery(env, ctx);

    if (controller.cron === WEEKLY_DIGEST_CRON) {
      // Monday morning: the operator gets last week's business numbers
      // alongside the weekly digests. Idempotency-keyed per day, so a cron
      // retry cannot double-send.
      ctx.waitUntil(
        sendWeeklyBusinessNumbers(env).then(
          (result) => {
            if (result.sent) {
              console.log("weekly business numbers sent");
            }
          },
          (error) => reportScheduledTaskFailure(env, "weekly_business_numbers", error),
        ),
      );
    }

    if (scheduledTask.kind === "discovery_warmup") {
      ctx.waitUntil(
        runScheduledDiscoveryWarmup(env).then(
          undefined,
          (error) => reportScheduledTaskFailure(env, "discovery_warmup", error),
        ),
      );
      ctx.waitUntil(
        import("../app/lib/monitoring-fanout.server").then(({ reconcileOrchestratedWatchlistRuns, resolveMonitoringFanoutMode, resolveMonitoringOrchestrationLeaseMs }) =>
          reconcileOrchestratedWatchlistRuns(env, {
            mode: resolveMonitoringFanoutMode(env),
            leaseMs: resolveMonitoringOrchestrationLeaseMs(env),
          }),
        ).then(
          (result) => {
            if (
              result.redispatched > 0 ||
              result.recovered > 0 ||
              result.cancelled > 0 ||
              result.firstScans.redispatched > 0 ||
              result.firstScans.cancelled > 0 ||
              result.firstScans.failures > 0
            ) {
              console.log("monitoring fanout reconciliation completed", result);
            }
          },
          (error) => reportScheduledTaskFailure(env, "monitoring_fanout_reconciliation", error),
        ),
      );
      // The six-hourly warmup also hosts the instant-alert flush: alerts
      // deferred by quiet hours get sent once the window ends, and failed
      // instant sends get retried.
      ctx.waitUntil(
        flushDeferredInstantAlerts(env).then(
          (result) => {
            if (result.groups > 0) {
              console.log("instant alert flush completed", result);
            }
          },
          (error) => reportScheduledTaskFailure(env, "instant_alert_flush", error),
        ),
      );
      // ...and the bounded retention sweep that keeps D1 tables from
      // growing forever.
      ctx.waitUntil(
        runRetentionSweep(env).then(
          async (result) => {
            const total = Object.values(result.deleted).reduce((sum, count) => sum + count, 0);
            if (total > 0) {
              console.log("retention sweep completed", result.deleted);
            }
            if (result.failedSteps.length > 0) {
              await reportScheduledTaskFailure(
                env,
                "retention_sweep",
                new Error(`Retention sweep failed for steps: ${result.failedSteps.join(", ")}`),
              );
            }
          },
          (error) => reportScheduledTaskFailure(env, "retention_sweep", error),
        ),
      );
      ctx.waitUntil(
        import("../app/lib/presence-service.server").then(({ runPresencePollingBatch }) =>
          runPresencePollingBatch(env, { limit: 20 }),
        ).then(
          (result) => {
            if (result.results.length > 0) {
              console.log("presence polling batch completed", result);
            }
          },
          (error) => reportScheduledTaskFailure(env, "presence_polling_batch", error),
        ),
      );
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
        async (result) => {
          console.log("scheduled monitoring completed", {
            cron: controller.cron,
            ...result,
          });
          if (
            scheduledTask.includeRiskAlert ||
            result.skippedForBudget > 0 ||
            result.dispatchFailures > 0
          ) {
            const scheduledDay = new Date(controller.scheduledTime).toISOString().slice(0, 10);
            const operationalIdempotencyKey = resolveOperationalRiskAlertIdempotencyKey(
              scheduledDay,
              {
                skippedForBudget: result.skippedForBudget,
                dispatchFailures: result.dispatchFailures,
              },
            );
            try {
              const alert = await sendCustomerAtRiskAlert(env, {
                skippedForBudget: result.skippedForBudget,
                dispatchFailures: result.dispatchFailures,
                idempotencyKey: scheduledTask.includeRiskAlert
                  ? undefined
                  : operationalIdempotencyKey ?? undefined,
              });
              if (alert.sent) {
                console.log("customer-at-risk alert sent", alert);
              }
            } catch (error) {
              await reportScheduledTaskFailure(env, "customer_at_risk_alert", error, {
                cron: controller.cron,
              });
            }
          }
        },
        (error) =>
          reportScheduledTaskFailure(env, "scheduled_monitoring", error, {
            cron: controller.cron,
          }),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
