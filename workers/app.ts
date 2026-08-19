/// <reference path="../.react-router/types/+server-build.d.ts" />

import { createRequestHandler, RouterContextProvider } from "react-router";

import { cloudflareRuntimeContext } from "../app/lib/cloudflare-context";
import { reportScheduledTaskFailure } from "../app/lib/cron-failure-alert.server";
import { resumePendingDigestScheduleJobsDetailed } from "../app/lib/digest-orchestration.server";
import {
  flushDeferredInstantAlerts,
  runScheduledDiscoveryWarmup,
  runScheduledMonitoring,
  sendCustomerAtRiskAlert,
  sendWeeklyBusinessNumbers,
} from "../app/lib/monitoring.server";
import { sendMonthlyCustomerRecaps } from "../app/lib/monthly-recap.server";
import {
  isPublicMarkdownPage,
  LLMS_TEXT,
  PUBLIC_MARKDOWN,
  wantsPublicMarkdown,
} from "../app/lib/public-markdown";
import { publicSeoFileForPathname } from "../app/lib/seo";
import { publicSitemapFile } from "../app/lib/sitemap.server";
import { enforceRequestRateLimit } from "../app/lib/rate-limit.server";
import {
  observeScheduledTask,
  type ReleaseScheduledTaskName,
} from "../app/lib/release-scheduled-observation.server";
import { runRetentionSweep } from "../app/lib/retention.server";
import {
  sendScheduledObservationGapAlert,
  SCHEDULED_OBSERVATION_GAP_CHECK_CRON,
} from "../app/lib/scheduled-observation-health.server";
import { scheduleBillingLifecycleEmailRecovery } from "./delivery-recovery";
import { scheduleDigestScheduleExhaustionRecovery } from "./digest-schedule-recovery";
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

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  process.env.NODE_ENV === "development" ? "development" : "production"
);

const DIGEST_RECOVERY_TIME_BUDGET_MS = 10 * 60 * 1000;

function markdownResponse(request: Request, body: string): Response {
  return withSecurityHeaders(
    new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "vary": "Accept",
        "content-signal": "search=yes, ai-input=yes, ai-train=no, use=reference",
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

    // /sitemap.xml is dynamic: the static funnel paths plus the indexable
    // /ads/:domain brand pages backed by the discovery cache — see
    // app/lib/sitemap.server.ts. It degrades to the static list when D1 is
    // absent; robots.txt and the social card below stay fully static.
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === "/sitemap.xml"
    ) {
      return publicFileResponse(request, await publicSitemapFile(env));
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

    // WP-10: durable creative thumbnails for saved collection ads (R2).
    // MINOR: serve only after the request rate-limit gate; raster types only.
    if (request.method === "GET" || request.method === "HEAD") {
      const { parseCreativeArtifactPathname, serveCreativeArtifact } = await import(
        "../app/lib/creative-thumbnail.server"
      );
      const creativeId = parseCreativeArtifactPathname(url.pathname);
      if (creativeId) {
        const artifactResponse = await serveCreativeArtifact(env, request, creativeId);
        if (artifactResponse) {
          return withSecurityHeaders(artifactResponse, request);
        }
      }

      // Visual diff: stored proof-capture screenshots behind the watchlist
      // change feed's before/now plates. Same unguessable-key model as the
      // creative thumbnails; raster-only, key-shape-gated.
      const { parseProofScreenshotPathname } = await import("../app/lib/proof-screenshot");
      const { serveProofScreenshot } = await import("../app/lib/proof-screenshot.server");
      const proofKey = parseProofScreenshotPathname(url.pathname);
      if (proofKey) {
        const screenshotResponse = await serveProofScreenshot(env, request, proofKey);
        if (screenshotResponse) {
          return withSecurityHeaders(screenshotResponse, request);
        }
      }
    }

    (globalThis as GlobalEnvCarrier).__APP_REQUEST_ENV__ = env;
    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareRuntimeContext, {
      env,
      ctx,
      country: request.headers.get("cf-ipcountry"),
    });
    const response = await requestHandler(request, routerContext);
    return withSecurityHeaders(response, request);
  },
  async scheduled(controller, env, ctx) {
    const observationContext = Object.freeze({
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    });

    if (controller.cron === SCHEDULED_OBSERVATION_GAP_CHECK_CRON) {
      // This in-Worker check detects gaps among individual workload crons. The
      // external GitHub deep-health probe detects a total Worker cron outage.
      // Preserve the shared outbox drain without trying to record this check
      // cron in the release-soak observation table, whose contract intentionally
      // accepts only the four production workload schedules.
      scheduleBillingLifecycleEmailRecovery(env, ctx);
      ctx.waitUntil(
        sendScheduledObservationGapAlert(env).then(
          (result) => {
            if (result.reason !== "healthy") {
              console.log("scheduled observation gap check completed", {
                unhealthy: result.health.filter(
                  (entry) => entry.overdue || entry.futureEvidence,
                ).length,
                sent: result.sent,
              });
            }
          },
          (error) =>
            reportScheduledTaskFailure(env, "scheduled_observation_gap_check", error),
        ),
      );
      return;
    }

    const scheduledTask = resolveScheduledTask(controller.cron);
    // Every cron also drains a bounded customer-email outbox. Keeping this
    // before the warmup early return ensures a worker that stopped after the
    // durable pre-dispatch claim cannot strand a finalized billing event.
    scheduleBillingLifecycleEmailRecovery(env, ctx, { observationContext });
		const observe = <T>(taskName: ReleaseScheduledTaskName, taskPromise: Promise<T>) =>
			observeScheduledTask(env, ctx, { ...observationContext, taskName }, taskPromise);

    if (controller.cron === WEEKLY_DIGEST_CRON) {
      // Monday morning: the operator gets last week's business numbers
      // alongside the weekly digests. Idempotency-keyed per day, so a cron
      // retry cannot double-send.
      ctx.waitUntil(
        observe("weekly_business_numbers", sendWeeklyBusinessNumbers(env)).then(
          (result) => {
            if (result.sent) {
              console.log("weekly business numbers sent");
            }
          },
          (error) => reportScheduledTaskFailure(env, "weekly_business_numbers", error),
        ),
      );
      // WP-26: first Monday of the month → prior-month customer recap.
      ctx.waitUntil(
        sendMonthlyCustomerRecaps(env, { scheduledTime: controller.scheduledTime }).then(
          async (result) => {
            if (result.sent > 0) {
              console.log("monthly customer recaps sent", result);
            }
            if (result.failed > 0) {
              await reportScheduledTaskFailure(
                env,
                "monthly_customer_recaps_degraded",
                new Error(`monthly customer recaps completed with ${result.failed} failed recipients`),
              );
            }
          },
          (error) => reportScheduledTaskFailure(env, "monthly_customer_recaps", error),
        ),
      );
    }

    if (scheduledTask.kind === "discovery_warmup") {
		scheduleDigestScheduleExhaustionRecovery(env, ctx, { observationContext });
		ctx.waitUntil(
			observe("digest_schedule_recovery", resumePendingDigestScheduleJobsDetailed(env, {
				deadlineAt: Date.now() + DIGEST_RECOVERY_TIME_BUDGET_MS,
			})).then(
				(result) => {
					if (result.sent > 0) {
						console.log("pending digest schedule jobs recovered", { digests: result.sent });
					}
				},
				(error) => reportScheduledTaskFailure(env, "digest_schedule_recovery", error),
			),
		);
      ctx.waitUntil(
        observe("discovery_warmup", runScheduledDiscoveryWarmup(env, ctx)).then(
          undefined,
          (error) => reportScheduledTaskFailure(env, "discovery_warmup", error),
        ),
      );
      ctx.waitUntil(
        observe("monitoring_fanout_reconciliation", import("../app/lib/monitoring-fanout.server").then(({ reconcileOrchestratedWatchlistRuns, resolveMonitoringFanoutMode, resolveMonitoringOrchestrationLeaseMs }) =>
          reconcileOrchestratedWatchlistRuns(env, {
            mode: resolveMonitoringFanoutMode(env),
            leaseMs: resolveMonitoringOrchestrationLeaseMs(env),
          }),
        )).then(
          async (result) => {
            const firstScans = result.firstScans ?? {
              redispatched: 0,
              cancelled: 0,
              failures: 0,
            };
            if (
              result.redispatched > 0 ||
              result.recovered > 0 ||
              result.cancelled > 0 ||
              result.redispatchFailures > 0 ||
              firstScans.redispatched > 0 ||
              firstScans.cancelled > 0 ||
              firstScans.failures > 0
            ) {
              console.log("monitoring fanout reconciliation completed", result);
            }
            if (result.redispatchFailures > 0) {
              await reportScheduledTaskFailure(
                env,
                "monitoring_fanout_reconciliation_redispatch",
                new Error("one or more monitoring fanout redispatches failed"),
              );
            }
          },
          (error) => reportScheduledTaskFailure(env, "monitoring_fanout_reconciliation", error),
        ),
      );
      // The six-hourly warmup also hosts the instant-alert flush: alerts
      // deferred by quiet hours get sent once the window ends, and failed
      // instant sends get retried.
      ctx.waitUntil(
        observe("instant_alert_flush", flushDeferredInstantAlerts(env)).then(
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
        observe("retention_sweep", runRetentionSweep(env)).then(
          async (result) => {
            const total = Object.values(result.deleted).reduce((sum, count) => sum + count, 0);
            const failedSteps = result.failedSteps ?? [];
            if (total > 0) {
              console.log("retention sweep completed", result.deleted);
            }
            if (failedSteps.length > 0) {
              await reportScheduledTaskFailure(
                env,
                "retention_sweep",
                new Error(`Retention sweep failed for steps: ${failedSteps.join(", ")}`),
              );
            }
          },
          (error) => reportScheduledTaskFailure(env, "retention_sweep", error),
        ),
      );
      ctx.waitUntil(
        observe("presence_polling_batch", import("../app/lib/presence-service.server").then(({ runPresencePollingBatch }) =>
          runPresencePollingBatch(env, { limit: 20 }),
        )).then(
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
      observe("scheduled_monitoring", runScheduledMonitoring(env, {
        includeScans: scheduledTask.includeScans,
        includeDigests: scheduledTask.includeDigests,
        digestCadence: scheduledTask.digestCadence,
        digestLookbackDays: scheduledTask.digestLookbackDays,
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
        // The scheduled handler's real ExecutionContext: slow telemetry row
        // writes are registered with waitUntil (background completion, never
        // request latency) down through scans and proof captures.
        executionContext: ctx,
      })).then(
        async (result) => {
          console.log("scheduled monitoring completed", {
            cron: controller.cron,
            ...result,
          });
          if (
            scheduledTask.includeRiskAlert ||
            result.skippedForBudget > 0 ||
            result.dispatchFailures > 0 ||
            result.inlineFailures > 0 ||
            result.digestFailures > 0
          ) {
            const scheduledDay = new Date(controller.scheduledTime).toISOString().slice(0, 10);
            const operationalIdempotencyKey = resolveOperationalRiskAlertIdempotencyKey(
              scheduledDay,
              {
                skippedForBudget: result.skippedForBudget,
                dispatchFailures: result.dispatchFailures,
                inlineFailures: result.inlineFailures,
                digestFailures: result.digestFailures,
              },
            );
            try {
              const alert = await observe("customer_at_risk_alert", sendCustomerAtRiskAlert(env, {
                skippedForBudget: result.skippedForBudget,
                dispatchFailures: result.dispatchFailures,
                inlineFailures: result.inlineFailures,
                digestFailures: result.digestFailures,
                idempotencyKey: scheduledTask.includeRiskAlert
                  ? undefined
                  : operationalIdempotencyKey ?? undefined,
              }));
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
