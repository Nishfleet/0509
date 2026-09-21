/// <reference path="../.react-router/types/+server-build.d.ts" />

import { createRequestHandler, RouterContextProvider } from "react-router";

import { cloudflareRuntimeContext } from "../app/lib/cloudflare-context";
import { pingLiveness } from "../app/lib/liveness-ping.server";
import { enforceRequestRateLimit } from "../app/lib/rate-limit.server";
import { publicSeoFileForPathname } from "../app/lib/seo";
import { canonicalPathRedirect } from "./canonical-path";
import { enforceOriginAssertion } from "./origin-assertion";
import { primaryDomainRedirect } from "./primary-domain";
import { withSecurityHeaders, generateCspNonce } from "./security-headers";
import {
  EDGE_CACHE_ELIGIBLE_HEADER,
  edgeCacheCopyIsStale,
  edgeCacheVersionId,
  edgeHtmlCacheStorage,
  isEdgeCacheableHtmlRequest,
  matchEdgeCache,
  storeEdgeCache,
} from "./edge-cache";
import {
  hasSiteRepAuthCookie,
  isSiteRepWidgetIsolatedPath,
} from "../app/lib/siterep-widget";
export { MonitoringWorkflow } from "./monitoring-workflow";
// Issue #3782: per-ad enrichment lease — one Durable Object instance per
// metaAdId so the in-flight claim holds across isolates.
export { SelectionEnrichmentLease } from "./selection-enrichment-lease";

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
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

    const publicSeoFile = publicSeoFileForPathname(url.pathname);
    if ((request.method === "GET" || request.method === "HEAD") && publicSeoFile) {
      return publicFileResponse(request, publicSeoFile);
    }

    // Origin / Sec-Fetch-Site assertion (issue #2986): the ONE worker-level
    // CSRF check. State-changing requests (POST/PUT/DELETE) under /app/* and
    // /api/v1/* must present same-site evidence — Sec-Fetch-Site:
    // same-origin|none, or an Origin header matching this request's own
    // scheme+host+port — or they 403 here, BEFORE the rate-limit gate so a
    // rejected request costs no D1. The no-header client class (curl / undici
    // / Python-requests hitting the documented Bearer-key
    // POST /api/v1/actions) passes untouched: API-key auth, no session
    // cookie, no CSRF surface. Both directions are proven by
    // tests/worker-origin-assertion.test.ts. See workers/origin-assertion.ts.
    const originGateResponse = enforceOriginAssertion(request);
    if (originGateResponse) {
      return withSecurityHeaders(originGateResponse, request);
    }

    const rateLimitResponse = await enforceRequestRateLimit(request, env, ctx);
    if (rateLimitResponse) {
      return withSecurityHeaders(rateLimitResponse, request);
    }

    // EDGE CACHE (issue #2950): anonymous, cookie-free GETs of the public
    // marketing HTML are served straight from the named edge cache; every
    // other response keeps its existing path untouched. A stored copy is a
    // NONCE-FREE VARIANT of the fully-secured response — script-src keeps its
    // host tokens but swaps 'nonce-…' for 'sha256-…' hashes of the stored
    // body's own inline scripts — which is what makes #2716's removal
    // condition ("the nonce problem actually solved") hold: no nonce is ever
    // shared between visitors. See workers/edge-cache.ts. The version-epoch
    // cache key (edgeCacheVersionId) is the deploy invalidation: a fresh
    // version id never replays a previous deploy's asset manifest.
    // The lookup deliberately sits AFTER the rate-limit gate so the anonymous
    // funnel counters keep their rows; what a HIT skips is the render itself.
    // In the Node test harness edgeHtmlCacheStorage() resolves to null and the
    // worker behaves exactly as before this issue (no stamps, no caching).
    const edgeCache = await edgeHtmlCacheStorage();
    const edgeVersionId = edgeCacheVersionId(env);

    // One render+store pipeline, run inline on a miss and in the background
    // on a stale hit (#3247): serving a copy past its fresh bound instantly is
    // the whole point of the serve-stale window, but leaving it stale would
    // let probe-only traffic alternate MISS/HIT forever — the waitUntil'd
    // refresh stores a fresh copy so the next anonymous visitor gets a recent
    // document. Fail-open like every other edge-cache path: a refresh error
    // never touches the served response.
    const renderAndStore = async (): Promise<Response> => {
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
      // React Router 8 answers a HEAD with a null document body (server.js
      // ">if (request.method === "HEAD") return new Response(null, ..."), so an
      // edge-cacheable HEAD is rendered through a GET-ified request instead: the
      // cache then stores the FULL-BODY document, and the HEAD reply keeps only
      // the stored copy's headers (the #2393 headOf pattern). Non-eligible
      // requests keep their original request untouched. The nonce'd render is
      // what storeEdgeCache receives; it returns the nonce-free variant it
      // stored, so the first anonymous visitor and every cached visitor see the
      // exact same document.
      let routerRequest: Request = request;
      if (isEdgeCacheableHtmlRequest(request)) {
        const routerHeaders = new Headers(request.headers);
        // Issue #3391: the router learns it is rendering the SHARED anonymous
        // variant, so the loader suppresses the #1972 fresh-anon Set-Cookie (a
        // stored copy must stay cookie-free — see EDGE_CACHE_ELIGIBLE_HEADER).
        routerHeaders.set(EDGE_CACHE_ELIGIBLE_HEADER, "1");
        routerRequest = new Request(request.url, { method: "GET", headers: routerHeaders });
      }
      const response = await requestHandler(routerRequest, routerContext);
      return storeEdgeCache(
        request,
        edgeCache,
        edgeVersionId,
        withSecurityHeaders(withPublicContentSignal(response, request), request, cspNonce),
      );
    };

    const cachedEdgeHtml = await matchEdgeCache(request, edgeCache, edgeVersionId);
    if (cachedEdgeHtml) {
      if (edgeCacheCopyIsStale(cachedEdgeHtml)) {
        ctx.waitUntil(renderAndStore().catch(() => {}));
      }
      return cachedEdgeHtml;
    }
    return renderAndStore();
  },

  // REBUILD P2 C3 (#3862): every scheduled arm that ran here read pre-rebuild
  // tables migrations/0001_init.sql does not create (status_probe_samples,
  // release_scheduled_observation, scheduled_observation_*,
  // cron_failure_alert_*, watchlist, digest_schedule_job, delivery_*,
  // source_snapshot). The kept engine modules stay on disk as P3's raw
  // material, but the hard rule for this sweep is that nothing reachable at
  // runtime — route, loader, action or cron — may read a dropped table, so
  // the rail goes inert here until P3 rewires the kept modules against the
  // fresh schema. The Cron Triggers still fire on their wrangler schedules.
  //
  // One arm survives: the dead-man ping. It reads no D1 table at all — it is an
  // outbound HTTP report to an external service — so it does not touch the
  // reachability rule, and it is the one signal a Worker cannot fake. Every
  // other health check here is computed BY the Worker it describes and so goes
  // quiet exactly when it matters. docs/REBUILD-DONE.md gates completion on
  // this ping running seven consecutive days without a miss, so it must not go
  // inert between the cut and P3.
  async scheduled(_controller, env, ctx) {
    const livenessPing = pingLiveness(env);
    if (livenessPing) ctx.waitUntil(livenessPing);
  },
};
