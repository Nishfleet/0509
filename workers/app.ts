/// <reference path="../.react-router/types/+server-build.d.ts" />

import { createRequestHandler, RouterContextProvider } from "react-router";

import { isBuyerSurfaceLocaleId } from "../app/lib/locale-markets";
import { cloudflareRuntimeContext } from "../app/lib/cloudflare-context";
import { reportScheduledTaskFailure } from "../app/lib/cron-failure-alert.server";
import {
  runDemoBrandBackfill,
  runDemoBrandProofHoleCatchUp,
  summarizeDemoBrandBackfill,
} from "../app/lib/demo-brand-backfill.server";
import {
  runSneakerResaleBackfill,
  summarizeSneakerResaleBackfill,
} from "../app/lib/sneaker-resale-backfill.server";
import {
  runSitemapTimelineBackfill,
  summarizeSitemapTimelineBackfill,
} from "../app/lib/sitemap-timeline-backfill.server";
import { resumePendingDigestScheduleJobsDetailed } from "../app/lib/digest-orchestration.server";
import { runAdsDomainPublisher } from "../app/lib/ads-domain-publisher.server";
import {
  flushDeferredInstantAlerts,
  runScheduledDiscoveryWarmup,
  runScheduledMonitoring,
  sendCustomerAtRiskAlert,
  sendWeeklyBusinessNumbers,
} from "../app/lib/monitoring.server";
import { sendMonthlyCustomerRecaps } from "../app/lib/monthly-recap.server";
import { runOnboardingNudgeSweep } from "../app/lib/onboarding-nudge.server";
import {
  isPublicMarkdownPage,
  buildLlmsText,
  PUBLIC_MARKDOWN,
  wantsPublicMarkdown,
} from "../app/lib/public-markdown";
import { publicSeoFileForPathname } from "../app/lib/seo";
import {
  loadIndexableBrandPageEntries,
  loadIndexableTimelineEntries,
  publicLocaleSitemapFile,
  publicSitemapFile,
  SITEMAP_TIMELINE_READ_LIMIT,
  timelineSitemapEntries,
} from "../app/lib/sitemap.server";
import { buildLlmsFullText, loadLlmsFullBrandBlocks } from "../app/lib/llms-full.server";
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

function publicFileResponse(
  request: Request,
  file: {
    body: string | Uint8Array<ArrayBuffer>;
    contentType: string;
    cacheControl: string;
  },
): Response {
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

    // Locale-prefixed /<locale>/sitemap.xml (issue #1501 + #1561): each
    // buyer-surface locale ships a LOCALE-SCOPED sitemap body containing only
    // paths under /<locale>/ — never the EN root body (that was the #1561
    // bug: the locale sitemaps mirrored the root byte-for-byte, fragmenting
    // crawl budget and splitting PageRank across duplicates). Reaching this
    // code path here avoids loading the React Router tree just to serve the
    // scoped XML under the locale prefix. `isBuyerSurfaceLocaleId` gates the
    // first segment against the allowlist so an unknown locale
    // (`/xx/sitemap.xml`) cannot silently inherit the root sitemap body.
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname.endsWith("/sitemap.xml")
    ) {
      const localeSegment = url.pathname.split("/")[1] ?? "";
      if (
        localeSegment !== "" &&
        url.pathname === `/${localeSegment}/sitemap.xml` &&
        isBuyerSurfaceLocaleId(localeSegment)
      ) {
        return publicFileResponse(
          request,
          await publicLocaleSitemapFile(localeSegment),
        );
      }
    }

    const publicSeoFile = publicSeoFileForPathname(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && publicSeoFile) {
      return publicFileResponse(request, publicSeoFile);
    }

    // Per-route Open Graph social cards (issue #1572): dynamic SVG cards for
    // the programmatic buyer surfaces (/ads/:domain, /compare/*, /switch/*,
    // /sneaker-resale, /competitor-monitoring) served under /social-card/...
    // so each surface stamps a branded og:image instead of the generic
    // og-image.png. Stateless and public — same serving path as the static
    // social card above, before the rate-limit gate.
    //
    // The /ads and /timeline cards are rasterized to PNG (issue #2089) so
    // social scrapers render them; compare/switch/cluster stay SVG (issue
    // #2083's scope). The rasterizer lives in a worker-only module because its
    // wasm-bindgen glue is not resolvable in the node test environment.
    if (request.method === "GET" || request.method === "HEAD") {
      const { publicSocialCardForRequest } = await import(
        "../app/lib/social-cards.server"
      );
      const socialCard = publicSocialCardForRequest(request);
      if (socialCard) {
        if (socialCard.kind === "ads" || socialCard.kind === "timeline") {
          const { rasterizeSocialCardPngCached } = await import(
            "../app/lib/social-cards-raster.server"
          );
          const png = await rasterizeSocialCardPngCached(
            request.url,
            socialCard.body,
          );
          // `asPng()` returns a `Uint8Array<ArrayBufferLike>`; copy it into a
          // fresh `Uint8Array` so it is a valid `BodyInit` for the Response.
          return publicFileResponse(request, {
            body: new Uint8Array(png),
            contentType: "image/png",
            cacheControl: socialCard.cacheControl,
          });
        }
        return publicFileResponse(request, socialCard);
      }
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/llms.txt") {
      // Same indexable /ads/:domain and /timeline/:domain sets as sitemap.xml —
      // never list a noindex shell. Timeline loader degrades to [] when D1 or
      // the snapshot table is missing, so the no-D1 / demo path stays byte-
      // identical to the static funnel (issue #1929).
      const [brandEntries, captureBackedTimelineEntries] = await Promise.all([
        loadIndexableBrandPageEntries(env),
        loadIndexableTimelineEntries(env),
      ]);
      return markdownResponse(
        request,
        buildLlmsText(
          brandEntries,
          timelineSitemapEntries(brandEntries, captureBackedTimelineEntries),
        ),
      );
    }
    // /llms-full.txt (issue #2043): public full-text feed of tracked-brand
    // dated offer/proof/change records. Reads the same bounded D1 window the
    // sitemap uses (SITEMAP_TIMELINE_READ_LIMIT rows, captured_at ASC) and
    // reuses the /timeline/:domain ledger logic (rowToSnapshot +
    // buildOfferLedger) so the proof, ad-destination, and run-collapse gates
    // are identical. Degrades to an honest empty feed when D1 is absent or the
    // table is missing — never a 500, never fabricated rows. Served before
    // the rate-limit gate because it is a public, zero-cost, cacheable read
    // (same posture as /llms.txt and /sitemap.xml above).
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === "/llms-full.txt"
    ) {
      const blocks = await loadLlmsFullBrandBlocks(env, SITEMAP_TIMELINE_READ_LIMIT);
      return markdownResponse(request, buildLlmsFullText(blocks));
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

      const { parseProofPageTextPathname } = await import("../app/lib/proof-page-text");
      const { serveProofPageText } = await import("../app/lib/proof-page-text.server");
      const pageTextKey = parseProofPageTextPathname(url.pathname);
      if (pageTextKey) {
        const pageTextResponse = await serveProofPageText(env, request, pageTextKey);
        if (pageTextResponse) {
          return withSecurityHeaders(pageTextResponse, request);
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
      // Issue #1919: the nightly 04:00 backfill cannot close a live 410 until
      // the next UTC day. Ride the existing hourly gap-check rail (no new
      // cron — soak still covers only the four workload schedules) and only
      // spend a capture pass while a demo brand still has zero proof rows.
      ctx.waitUntil(
        runDemoBrandProofHoleCatchUp(env).then(
          (result) => {
            if (result.skipped) {
              return;
            }
            console.log("demo brand proof-hole catch-up completed", {
              missing: result.missingDomains,
              day: result.backfill?.day,
              captured: result.backfill?.capturedCount,
              failed: result.backfill?.failedCount,
              summary: result.backfill
                ? summarizeDemoBrandBackfill(result.backfill)
                : null,
            });
          },
          (error) =>
            reportScheduledTaskFailure(env, "demo_brand_proof_hole_catch_up", error),
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
            if (total > 0 || result.orphanReconcile) {
              console.log("retention sweep completed", {
                deleted: result.deleted,
                orphanReconcile: result.orphanReconcile,
              });
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

    // Nightly demo-brand Offer Timeline backfill (issue #1449): folded into
    // the one existing cron that fires exactly once per UTC day (the 04:00
    // digest rail). A new wrangler cron would escape the release-soak gap
    // coverage (the soak table's CHECK accepts only the four production
    // crons), so the backfill rides the daily rail instead; the corpus still
    // grows exactly once per day, and rollback = removing this block (the
    // digest cron and watchlist runs continue untouched).
    if (scheduledTask.kind === "monitoring" && scheduledTask.digestCadence === "daily") {
      ctx.waitUntil(
        runDemoBrandBackfill(env).then(
          (result) => {
            console.log("demo brand backfill completed", {
              day: result.day,
              captured: result.capturedCount,
              failed: result.failedCount,
              summary: summarizeDemoBrandBackfill(result),
            });
          },
          (error) =>
            reportScheduledTaskFailure(env, "demo_brand_backfill", error),
        ),
      );
      // Abandoned-onboarding nudge (issue #2114): rides the same 04:00 daily
      // rail as the demo-brand backfill for the same release-soak reason (a
      // new wrangler cron would escape the CHECK that accepts only the four
      // production crons). The sweep selects users created 24-48h ago with
      // zero watchlists and no prior nudge, gates each on the 09:00-11:00
      // local send window (IST default), and sends exactly one plain-text-
      // first email per user, ever, via the mandated delivery.server path.
      ctx.waitUntil(
        runOnboardingNudgeSweep(env).then(
          (result) => {
            if (result.selected > 0) {
              console.log("onboarding nudge sweep completed", result);
            }
          },
          (error) =>
            reportScheduledTaskFailure(env, "onboarding_nudge_sweep", error),
        ),
      );
      // Nightly sitemap-timeline cohort backfill (issue #1958): calendly.com
      // and adspyder.io sit in no cohort, so their indexed /timeline/:domain
      // pages froze at the seed capture. This sibling rides the same daily
      // rail and re-captures every bounded, coverage-verified sitemap-listed
      // timeline domain each UTC day. Sibling, NOT chained after the
      // publisher: the tier read accepts any-age rows (no ordering hazard)
      // and a publisher whole-run failure cannot couple to the capture.
      ctx.waitUntil(
        runSitemapTimelineBackfill(env).then(
          (result) => {
            console.log("sitemap timeline backfill completed", {
              day: result.day,
              cohort: result.domains.length,
              captured: result.capturedCount,
              failed: result.failedCount,
              summary: summarizeSitemapTimelineBackfill(result),
            });
          },
          (error) =>
            reportScheduledTaskFailure(env, "sitemap_timeline_backfill", error),
        ),
      );
    }

    // Nightly programmatic /ads/:domain publisher (BET 5a, issue #1549):
    // rides the same 04:00 daily rail as the demo-brand backfill for the
    // same release-soak reason (a new wrangler cron would escape the CHECK
    // that accepts only the four production crons). The publisher gates on
    // SEARCH_ROLLOUT_MODE=v2, runs the search-v2 exact pipeline for country
    // "all" per seed-list domain, and lets the existing /ads/:domain loader
    // and dynamic sitemap pick up the written public_search cache rows. The
    // domain cap (ADS_DOMAIN_PUBLISHER_CAP, default 60) bounds the nightly
    // provider spend; a per-domain failure is logged and counted, never
    // thrown, and a whole-run failure surfaces through the same scheduled-
    // task alert channel as the backfill.
    if (scheduledTask.kind === "monitoring" && scheduledTask.digestCadence === "daily") {
      const publisherRun = runAdsDomainPublisher(env, ctx);
      ctx.waitUntil(
        publisherRun.then(
          (result) => {
            if (result.attempted > 0) {
              console.log("ads domain publisher completed", {
                list: result.list,
                gate: result.gate,
                attempted: result.attempted,
                published: result.published,
                skipped: result.skipped,
                warming: result.warming,
                failed: result.failed,
                invalid: result.invalid,
              });
            }
          },
          (error) =>
            reportScheduledTaskFailure(env, "ads_domain_publisher", error),
        ),
      );
      ctx.waitUntil(
        publisherRun
          // Issue #1946: the sneaker-resale cohort verdict reads the
          // publisher's `public_search` cache rows, which carry a 15-minute
          // TTL. As a sibling waitUntil it would read before the publisher's
          // awaited per-domain writes land, derive an empty tier map, and
          // capture zero brands every night. Chain after the publisher's
          // promise so this tick's rows are fresh; a publisher whole-run
          // failure still lets the backfill run best-effort (it pages via
          // its own block) and the empty-cohort guard keeps the honest 410.
          .catch(() => undefined)
          .then(() => runSneakerResaleBackfill(env))
          .then(
            (result) => {
              console.log("sneaker resale backfill completed", {
                day: result.day,
                captured: result.capturedCount,
                failed: result.failedCount,
                summary: summarizeSneakerResaleBackfill(result),
              });
            },
            (error) =>
              reportScheduledTaskFailure(env, "sneaker_resale_backfill", error),
          ),
      );
    }

    ctx.waitUntil(
      observe("scheduled_monitoring", runScheduledMonitoring(env, {
        includeScans: scheduledTask.includeScans,
        includeDigests: scheduledTask.includeDigests,
        includeMentionResweep: scheduledTask.includeMentionResweep,
        includeAutoCompetitorResweep: scheduledTask.includeAutoCompetitorResweep,
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
