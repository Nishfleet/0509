import { canUseSiteRepWidgetScript, hasSiteRepAuthCookie } from "../app/lib/siterep-widget";

// Baseline security headers applied to every response. CSP allows Google Fonts
// (used in app/root.tsx) and inline <script>/<style> emitted by React Router's
// <Scripts /> / <Links /> during SSR hydration. Tighten to nonces in a follow-up.
//
// Cloudflare Web Analytics is enabled for this zone with automatic (edge)
// injection, so Cloudflare inserts its RUM beacon script into every HTML
// response as it passes the edge. Without the beacon host in script-src the
// beacon is blocked by the CSP and analytics silently records zero page views.
// The beacon posts to /cdn-cgi/rum on the same origin, which connect-src 'self'
// already permits — see the Cloudflare Web Analytics CSP guidance:
// https://developers.cloudflare.com/web-analytics/faq/#what-do-i-need-to-add-to-my-content-security-policy-csp
// Exported so the live deploy gate (scripts/check-live-public-home.mjs) can be
// coupled to it via tests/worker-security-headers.test.ts and fail loudly if
// the beacon ever drops out of the deployed CSP again (PR #610 regression
// class: CSP blocks the beacon and analytics silently records zero page views).
export const CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
const BASE_SCRIPT_SRC = `script-src 'self' 'unsafe-inline' ${CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC}`;
const SITE_REP_WIDGET_SCRIPT_SRC = `${BASE_SCRIPT_SRC} https://siterep.net`;

export const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "content-security-policy": [
    "default-src 'self'",
    BASE_SCRIPT_SRC,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

export const HTML_NO_STORE_HEADERS: Record<string, string> = {
  "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "cdn-cache-control": "no-store",
  "cloudflare-cdn-cache-control": "no-store",
  pragma: "no-cache",
  expires: "0",
};

// PERF (2026-07-20): short browser caching for anonymous public HTML.
//
// Scope is deliberately narrow:
// - Anonymous requests only (no better-auth cookie): the root loader embeds
//   the session in every document, so any response rendered for a signed-in
//   user must stay no-store.
// - max-age=300 with NO stale-while-revalidate: deploys replace the hashed
//   asset manifest, so HTML held longer than a few minutes can reference
//   assets that no longer exist (the 2026-07-13 asset-skew incident class,
//   and what the "stale cached public HTML" regression test protects). Five
//   minutes bounds that window; SWR would stretch it to an hour.
// - Never cache a response that sets cookies.
// - `vary: cookie` so any honoring cache revalidates when auth state changes
//   (e.g. right after login) instead of replaying the logged-out variant.
export const PUBLIC_HTML_CACHE_CONTROL = "public, max-age=300";

const PUBLIC_CACHEABLE_HTML_PATHS = new Set([
  "/",
  "/pricing",
  "/help",
  "/docs",
  "/terms",
  "/privacy",
  "/changelog",
  "/trust",
  "/compare/magicbrief",
  "/compare/meta-ad-library",
  "/compare/visualping",
  "/compare/visualping-ad-library",
  "/compare/spyland",
  "/compare/pulzifi",
  "/compare/foreplay",
  "/compare/foreplay-spyder",
  "/compare/panoramata",
  "/compare/adspyder",
  "/switch/magicbrief",
  "/switch/panoramata",
  "/switch/visualping",
]);
const PUBLIC_CACHEABLE_HTML_PREFIXES = ["/ads/"] as const;

function isPublicCacheableHtmlRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  if (hasSiteRepAuthCookie(request)) {
    return false;
  }
  const pathname = new URL(request.url).pathname;
  return (
    PUBLIC_CACHEABLE_HTML_PATHS.has(pathname) ||
    PUBLIC_CACHEABLE_HTML_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function isHtmlResponse(headers: Headers) {
  return (headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

// Public share links must never end up in search results: they carry customer
// evidence behind an unguessable token. The header is set at the worker layer
// (not via a route meta/headers export) so it covers the document response AND
// the React Router data request ("/share/<token>.data"). robots.txt must keep
// /share/ crawlable so crawlers can actually SEE this header — see ROBOTS_TXT
// in app/lib/seo.ts.
const NOINDEX_PATH_PREFIXES = ["/share/"] as const;

// React Router matches routes case-insensitively and after percent-decoding,
// so /SHARE/<token> and /%73hare/<token> serve the same report as /share/<token>.
// Normalize the pathname the same way before the prefix check — otherwise those
// URL aliases would be served WITHOUT the noindex header and could get indexed.
// Over-matching is safe here (a noindex header on a 404 is harmless); missing
// the header on a live alias is the bug.
function normalizePathnameForNoindex(pathname: string): string {
	let decoded = pathname;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		// Malformed percent-encoding: keep the raw pathname.
	}
	return decoded.toLowerCase();
}

function isNoindexRequestPath(request?: Request): boolean {
	if (!request) {
		return false;
	}
	const pathname = normalizePathnameForNoindex(new URL(request.url).pathname);
	return NOINDEX_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function securityHeadersForRequest(responseHeaders: Headers, request?: Request): Record<string, string> {
  if (!request || !isHtmlResponse(responseHeaders)) {
    return SECURITY_HEADERS;
  }

  if (!canUseSiteRepWidgetScript(request)) {
    return SECURITY_HEADERS;
  }

  return {
    ...SECURITY_HEADERS,
    "content-security-policy": SECURITY_HEADERS["content-security-policy"].replace(
      BASE_SCRIPT_SRC,
      SITE_REP_WIDGET_SCRIPT_SRC,
    ),
  };
}

export function withSecurityHeaders(response: Response, request?: Request): Response {
  // Clone headers so we don't mutate a potentially-immutable response.
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeadersForRequest(headers, request))) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
  if (isHtmlResponse(headers)) {
    const cacheablePublicHtml =
      request !== undefined &&
      response.status === 200 &&
      !headers.has("set-cookie") &&
      isPublicCacheableHtmlRequest(request);
    if (cacheablePublicHtml) {
      // An explicitly-set cache-control on the app response wins. The
      // marketing page uses this for its SSR pricing: buyer-country prices are
      // embedded in the HTML, so it must stay private (browser-only) instead
      // of being shared-cached under the generic public policy — a cached
      // DE/EUR variant would otherwise be served to a US visitor and vice
      // versa. Security headers above still apply.
      if (!headers.has("cache-control")) {
        headers.set("cache-control", PUBLIC_HTML_CACHE_CONTROL);
        const vary = headers.get("vary");
        if (!vary) {
          headers.set("vary", "cookie");
        } else if (!vary.toLowerCase().split(",").some((v) => v.trim() === "cookie")) {
          headers.set("vary", `${vary}, cookie`);
        }
        headers.delete("cdn-cache-control");
        headers.delete("cloudflare-cdn-cache-control");
        headers.delete("pragma");
        headers.delete("expires");
      }
    } else {
      for (const [name, value] of Object.entries(HTML_NO_STORE_HEADERS)) {
        headers.set(name, value);
      }
    }
  }
	if (isNoindexRequestPath(request)) {
		headers.set("x-robots-tag", "noindex, nofollow");
	}
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
