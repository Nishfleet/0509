/// <reference path="../.react-router/types/+server-build.d.ts" />

import { createRequestHandler, RouterContextProvider } from "react-router";

import { isBuyerSurfaceLocaleId } from "../app/lib/locale-markets";
import { cloudflareRuntimeContext } from "../app/lib/cloudflare-context";
import {
  routesCatchAllForPath,
  tinyNotFoundResponse,
} from "./tiny-not-found";
import { maybeInlineMarketingRouteCss } from "./inline-route-css";
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
} from "../app/lib/monitoring.server";
import {
  sendWeeklyBusinessNumbers,
} from "../app/lib/operator-metrics-emails.server";
import { sendMonthlyCustomerRecaps } from "../app/lib/monthly-recap.server";
import { sendMonthlyReports } from "../app/lib/delivery.server";
import {
  runOnboardingNudgeSweep,
  runWatchlistResumeSweep,
} from "../app/lib/onboarding-nudge.server";
import {
  isPublicMarkdownPage,
  buildLlmsText,
  publicMarkdownForPath,
  wantsPublicMarkdown,
} from "../app/lib/public-markdown";
import { publicSeoFileForPathname } from "../app/lib/seo";
import {
  brandCategorySitemapEntries,
  loadIndexableBrandPageEntries,
  loadIndexableTimelineEntries,
  publicLocaleSitemapFile,
  publicSitemapFile,
  SITEMAP_TIMELINE_READ_LIMIT,
  timelineSitemapEntries,
} from "../app/lib/sitemap.server";
import { buildLlmsFullText, loadLlmsFullBrandBlocks } from "../app/lib/llms-full.server";
import {
  cleanupRateLimitEvents,
  enforceRequestRateLimit,
} from "../app/lib/rate-limit.server";
import {
  observeScheduledTask,
  type ReleaseScheduledTaskName,
} from "../app/lib/release-scheduled-observation.server";
import { runRetentionSweep } from "../app/lib/retention.server";
import {
  recordScheduledObservationGapCheckHeartbeat,
  sendScheduledObservationGapAlert,
  SCHEDULED_OBSERVATION_GAP_CHECK_CRON,
} from "../app/lib/scheduled-observation-health.server";
import { canonicalPathRedirect } from "./canonical-path";
import { scheduleBillingLifecycleEmailRecovery } from "./delivery-recovery";
import { scheduleDigestScheduleExhaustionRecovery } from "./digest-schedule-recovery";
import { primaryDomainRedirect } from "./primary-domain";
import {
  resolveScheduledTask,
  WEEKLY_DIGEST_CRON,
} from "./schedule";
import { withSecurityHeaders, generateCspNonce } from "./security-headers";
import {
  hasSiteRepAuthCookie,
  isSiteRepWidgetIsolatedPath,
} from "../app/lib/siterep-widget";
export { MonitoringWorkflow } from "./monitoring-workflow";

// Content-Signal (issue #2302): the AI-use reservation robots.txt declares once
// per crawl, and that markdownResponse already stamps on /llms.txt and the
// public markdown pages, carried by the public HTML documents it protects.
// robots.txt is not re-read per fetched page, so a grounding crawler that lands
// directly on a page sees no reservation at all; the signal has to travel with
// the page. Public routes only — withSecurityHeaders also covers authed
// documents and API responses, and an AI-training reservation on logged-in
// traffic would be wrong. Value must stay identical to the robots.txt posture
// in app/lib/seo.ts (docs/ai-crawler-policy.md).
export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no, use=reference";

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
        "content-signal": CONTENT_SIGNAL,
      },
    }),
    request,
  );
}

/**
 * Stamps the Content-Signal reservation on a PUBLIC HTML document response and
 * leaves every other response untouched:
 *
 * - GET/HEAD only, HTML responses only — API/JSON and asset responses never
 *   carry a crawl reservation.
 * - Anonymous requests only (no better-auth cookie).
 * - Outside the private prefixes robots.txt disallows or marks noindex
 *   (/app, /auth, /api/, /export/, /team/, /share/, /unsubscribe,
 *   /.well-known/) — the same surfaces isSiteRepWidgetIsolatedPath covers.
 * - A content-signal the app set itself wins.
 */
function withPublicContentSignal(response: Response, request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return response;
  }
  const headers = response.headers;
  if (headers.has("content-signal")) {
    return response;
  }
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return response;
  }
  if (hasSiteRepAuthCookie(request)) {
    return response;
  }
  if (isSiteRepWidgetIsolatedPath(new URL(request.url).pathname)) {
    return response;
  }
  const stamped = new Headers(headers);
  stamped.set("content-signal", CONTENT_SIGNAL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: stamped,
  });
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

    // Path canonicalization (issue #2955): one URL per public route — a
    // non-canonical casing or trailing slash 301s here, before any public
    // file or route handling, so /Pricing and /pricing/ stop serving
    // duplicates of /pricing. Exempt surfaces (assets, /api/*, /share/*,
    // ...) and non-GET/HEAD methods pass through untouched.
    const canonicalPathResponse = canonicalPathRedirect(request);
    if (canonicalPathResponse) {
      return withSecurityHeaders(canonicalPathResponse, request);
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
    // The /ads, /timeline, cluster (/sneaker-resale,
    // /competitor-monitoring), and guide (/guides/*) cards are rasterized to
    // PNG (issue #2089, issue #2101, issue #3098) so social scrapers render
    // them; compare/switch/brand stay SVG (issue #2083's scope). The
    // rasterizer lives in a worker-only module because its wasm-bindgen glue
    // is not resolvable in the node test environment.
    if (request.method === "GET" || request.method === "HEAD") {
      const { publicSocialCardForRequest } = await import(
        "../app/lib/social-cards.server"
      );
      const socialCard = publicSocialCardForRequest(request);
      if (socialCard) {
        if (
          socialCard.kind === "ads" ||
          socialCard.kind === "timeline" ||
          socialCard.kind === "cluster" ||
          socialCard.kind === "guide"
        ) {
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
      // Same indexable /ads/:domain, /brands/:slug, and /timeline/:domain
      // sets as sitemap.xml — never list a noindex shell (issue #2925
      // zero-parity: every sitemap URL is listed). Timeline loader degrades
      // to [] when D1 or the snapshot table is missing, so the no-D1 / demo
      // path stays byte-identical to the static funnel (issue #1929).
      const [brandEntries, captureBackedTimelineEntries] = await Promise.all([
        loadIndexableBrandPageEntries(env),
        loadIndexableTimelineEntries(env),
      ]);
      return markdownResponse(
        request,
        buildLlmsText(
          brandEntries,
          timelineSitemapEntries(captureBackedTimelineEntries),
          brandCategorySitemapEntries(brandEntries),
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
      // Issue #2299: serve the per-page markdown body for /methodology,
      // /pricing, and the /compare/* pages; the original ten pages keep the
      // single PUBLIC_MARKDOWN body. publicMarkdownForPath falls back to
      // PUBLIC_MARKDOWN for any path without a dedicated body.
      return markdownResponse(request, publicMarkdownForPath(url.pathname));
    }

    const rateLimitResponse = await enforceRequestRateLimit(request, env, ctx);
    if (rateLimitResponse) {
      return withSecurityHeaders(rateLimitResponse, request);
    }

    // WP-10: durable creative thumbnails for saved collection ads (R2).
    // MINOR: serve only after the request rate-limit gate; raster types only.
    if (request.method === "GET" || request.method === "HEAD") {
      // Issue #2393: edge-cached copy of a captured ad creative, so a public
      // /ads/:domain page keeps its images after the fbcdn signature expires.
      // Same-origin, D1-resolved id, .fbcdn.net-only fetch, 404 unknown ids.
      {
        const { parseCreativeResourcePathname, serveCreativeResource } = await import(
          "../app/lib/creative-edge-cache.server"
        );
        const creativeResourceId = parseCreativeResourcePathname(url.pathname);
        if (creativeResourceId) {
          const creativeResponse = await serveCreativeResource(env, request, creativeResourceId);
          if (creativeResponse) {
            return withSecurityHeaders(creativeResponse, request);
          }
        }
      }

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

    // Tiny purpose-built 404 (issue #2967): a GET/HEAD path whose only route
    // match is the terminal `*` catch-all is a genuine 404 by construction, so
    // serve the sub-1 KB static document instead of paying for the SSR render,
    // the root loader, the 256 KB root stylesheet, and the hydration bundle.
    // GET/HEAD only — actions must reach the SSR handler untouched. Runs after
    // every public-file/Markdown/proof surface so real content still wins.
    if (request.method === "GET" || request.method === "HEAD") {
      try {
        const serverBuild = await import("virtual:react-router/server-build");
        if (routesCatchAllForPath(serverBuild.routes, url.pathname, serverBuild.basename)) {
          return withSecurityHeaders(
            withPublicContentSignal(tinyNotFoundResponse(request), request),
            request,
          );
        }
      } catch (error) {
        // Never break the document path on the fast-path: fall through to the
        // SSR handler, which still serves the full not-found page. The catch
        // stays observable so a real matching bug cannot hide behind silence.
        console.error("tiny-404 fast path failed; falling back to SSR not-found", error);
      }
    }

    (globalThis as GlobalEnvCarrier).__APP_REQUEST_ENV__ = env;
    // One per-request CSP nonce (issue #2348): the same value is threaded into
    // the rendered HTML (via the cloudflare context → root loader → Layout)
    // and into the CSP script-src 'nonce-…' directive (via withSecurityHeaders)
    // so dropping 'unsafe-inline' does not break React Router hydration or the
    // two inline boot scripts.
    const cspNonce = generateCspNonce();
    const routerContext = new RouterContextProvider();
    routerContext.set(cloudflareRuntimeContext, {
      env,
      ctx,
      country: request.headers.get("cf-ipcountry"),
      cspNonce,
    });
    const response = await requestHandler(request, routerContext);
    // Issue #2967: marketing documents inline their route stylesheet (no
    // second render-blocking request on the landing cluster); every other
    // response passes through untouched. Falls back to the original document
    // on any error — see workers/inline-route-css.ts.
    const documentResponse = await maybeInlineMarketingRouteCss(response, request);
    return withSecurityHeaders(withPublicContentSignal(documentResponse, request), request, cspNonce);
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
      // Issue #2368: this check cron is itself unobserved — the soak table
      // accepts only the four workload crons, so a selective loss of just this
      // trigger left deep health green while the gap alerter was already dead.
      // Record our own heartbeat and let /api/health/deep report its freshness.
      // The key sits outside `landing-pages/`, so the R2 orphan reconciliation
      // sweep (app/lib/retention.server.ts) can never delete it.
      scheduleBillingLifecycleEmailRecovery(env, ctx);
      ctx.waitUntil(recordScheduledObservationGapCheckHeartbeat(env));
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
      // Issue #2422: auto-file one monthly report per paid workspace. This cron
      // fires four to five times a month, so the job gates on the UTC month
      // (workspace + YYYY-MM) and files only where that month has no report
      // share yet. No new cron: a fifth wrangler schedule would escape the
      // release-soak CHECK that accepts only the four production crons.
      ctx.waitUntil(
        sendMonthlyReports(env, { scheduledTime: controller.scheduledTime }).then(
          async (result) => {
            if (result.filed > 0) {
              console.log("monthly reports filed", result);
            }
            if (result.failed > 0) {
              await reportScheduledTaskFailure(
                env,
                "monthly_reports_degraded",
                new Error(`monthly reports completed with ${result.failed} failed workspaces`),
              );
            }
          },
          (error) => reportScheduledTaskFailure(env, "monthly_reports", error),
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
      // Paused-watchlist re-engagement (issue #2115): rides the same 04:00
      // daily rail as the abandoned-onboarding nudge for the same
      // release-soak reason (a new wrangler cron would escape the CHECK that
      // accepts only the four production crons). The sweep selects users who
      // own at least one watchlist paused 14+ days with no prior resume
      // attempt, gates each on the 09:00-11:00 local send window (IST
      // default), and sends exactly one plain-text-first resume email per
      // user, ever, via the mandated delivery.server path. No auto-resume,
      // no plan/gating changes, no discount or pricing copy.
      ctx.waitUntil(
        runWatchlistResumeSweep(env).then(
          (result) => {
            if (result.selected > 0) {
              console.log("watchlist resume sweep completed", result);
            }
          },
          (error) =>
            reportScheduledTaskFailure(env, "watchlist_resume_sweep", error),
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
      // rate_limit_events retention (issue #2402): the old 2% random cleanup
      // rode unrelated requests and added a DELETE to their latency. The
      // daily 04:00 rail keeps the table bounded instead.
      ctx.waitUntil(
        cleanupRateLimitEvents(env).then(
          undefined,
          (error) =>
            reportScheduledTaskFailure(env, "rate_limit_events_cleanup", error),
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
    // task alert channel as the backfill. The run iterates ALL SEED_LISTS as
    // one queue, stops starting new scrapes at a ~10-minute internal
    // deadline (issue #2361), persists a last_offset cursor so the next
    // night resumes where this one stopped, and emits truncated:true when
    // the deadline bites — so a wall-clock kill no longer restarts at domain
    // #1 and silently starves tail domains.
    if (scheduledTask.kind === "monitoring" && scheduledTask.digestCadence === "daily") {
      const publisherRun = runAdsDomainPublisher(env, ctx);
      ctx.waitUntil(
        publisherRun.then(
          (result) => {
            if (result.attempted > 0 || result.truncated) {
              console.log("ads domain publisher completed", {
                list: result.list,
                gate: result.gate,
                attempted: result.attempted,
                published: result.published,
                skipped: result.skipped,
                warming: result.warming,
                failed: result.failed,
                invalid: result.invalid,
                truncated: result.truncated,
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
        },
        (error) =>
          reportScheduledTaskFailure(env, "scheduled_monitoring", error, {
            cron: controller.cron,
          }),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
