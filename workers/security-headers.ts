import { canUseSiteRepWidgetScript, hasSiteRepAuthCookie } from "../app/lib/siterep-widget";

// Baseline security headers applied to every response. CSP uses a per-request
// nonce for inline <script> emitted by React Router's <Scripts /> /
// <ScrollRestoration /> and the two boot scripts in app/root.tsx — no
// 'unsafe-inline' in script-src. Inline <style> (React Router <Links />) still
// needs 'unsafe-inline' in style-src, which is the standard CSP trade-off.
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

// The Site Rep support widget (loaded only on public widget pages for
// anonymous visitors) loads its script from and makes API calls to
// https://siterep.net — see app/lib/siterep-widget.ts. Both the script-src and
// connect-src additions are scoped to those pages by securityHeadersForRequest.
export const SITE_REP_WIDGET_HOST = "https://siterep.net";

// script-src without a nonce: 'self' + the edge-injected beacon. A nonce is
// added per-request by securityHeadersForRequest when the worker renders HTML.
// 'unsafe-inline' is intentionally absent — a single stored XSS must not be
// able to run an arbitrary inline script (issue #2348).
const BASE_SCRIPT_SRC = `script-src 'self' ${CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC}`;

// React Router lazy route discovery fetches this same-origin path (see
// react-router fog-of-war). connect-src 'self' is what allows it. Keep the
// path named so a later connect-src tightening cannot drop the loader by
// accident — Firefox logged a Report-Only connect-src warning for it on
// /app/billing and /trust (issue #1051).
export const REACT_ROUTER_MANIFEST_PATH = "/__manifest";

// connect-src allowlist (issue #2348): 'self' covers every same-origin fetch —
// the React Router __manifest loader, all /api/* calls, and the Cloudflare Web
// Analytics beacon posting to /cdn-cgi/rum. The bare `https:` wildcard that
// used to be here let a single injected script exfiltrate session data to any
// host; it is gone. The Site Rep widget's cross-origin API calls
// (siterep.net /api/public/install + /api/public/config) are added only on the
// public widget pages where the widget actually loads.
export const CONNECT_SRC = "connect-src 'self'";
const CONNECT_SRC_WITH_SITE_REP_WIDGET = `connect-src 'self' ${SITE_REP_WIDGET_HOST}`;

function cspDirectiveSources(csp: string, name: string): string[] | null {
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (!directive) return null;
  if (directive === name) return [];
  return directive
    .slice(name.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether a CSP header allows the same-origin React Router `__manifest` fetch.
 * connect-src wins when present; otherwise default-src; if neither exists the
 * policy does not constrain connects.
 */
export function cspAllowsReactRouterManifest(csp: string): boolean {
  const sources =
    cspDirectiveSources(csp, "connect-src") ?? cspDirectiveSources(csp, "default-src");
  if (sources === null) return true;
  const withoutNoneIfOthers = sources.filter(
    (source) => source !== "'none'" || sources.length === 1,
  );
  if (withoutNoneIfOthers.length === 1 && withoutNoneIfOthers[0] === "'none'") {
    return false;
  }
  return (
    withoutNoneIfOthers.includes("'self'") ||
    withoutNoneIfOthers.includes("https:") ||
    withoutNoneIfOthers.includes("*") ||
    withoutNoneIfOthers.some((source) => source.includes(REACT_ROUTER_MANIFEST_PATH))
  );
}

/**
 * Generates a fresh per-request CSP nonce (base64 of 18 random bytes). The same
 * nonce is threaded into the CSP `script-src 'nonce-…'` directive AND into the
 * rendered HTML (React Router `<Scripts nonce>` / `<ScrollRestoration nonce>`
 * / `<Links nonce>` and the two boot scripts in app/root.tsx) so the browser
 * only runs inline scripts the server vouched for this response. A nonce that
 * is not in the CSP is useless, and a CSP nonce with no matching element blocks
 * hydration — both halves must use the same value from the same request.
 */
export function generateCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  // btoa is available in the Workers runtime; String.fromCharCode over the
  // byte array gives a binary string btoa can base64-encode.
  return btoa(String.fromCharCode(...bytes));
}

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
    CONNECT_SRC,
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

export const PUBLIC_CACHEABLE_HTML_PATHS = new Set([
  "/",
  "/pricing",
  "/help",
  "/docs",
  "/terms",
  "/privacy",
  "/changelog",
  "/trust",
  "/capture-rules",
  "/compare/meta-ad-library",
  "/compare/visualping",
  "/compare/visualping-ad-library",
  "/compare/visualping-ad-libraries",
  "/compare/spyland",
  "/compare/pulzifi",
  "/compare/foreplay",
  "/compare/foreplay-spyder",
  "/compare/panoramata",
  "/compare/adspyder",
  "/compare/adspy",
  "/switch/panoramata",
  "/switch/visualping",
  "/switch/magicbrief",
  "/methodology",
  "/methodology/ad-aggression-score",
]);
export const PUBLIC_CACHEABLE_HTML_PREFIXES = ["/ads/", "/timeline/"] as const;

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

// Builds the script-src directive for a response. When a per-request nonce is
// provided (HTML rendered by the React Router handler), 'nonce-<value>' is
// inserted so the inline boot scripts and React Router's hydration scripts can
// run without 'unsafe-inline'. When the Site Rep widget is active on the page,
// its script host is appended. Without a nonce the directive is the baseline
// ('self' + beacon) — non-HTML responses carry no inline scripts, so no nonce
// is needed and 'unsafe-inline' stays absent.
function buildScriptSrc(nonce: string | undefined, widgetHost: boolean): string {
  const sources = [`'self'`, CLOUDFLARE_WEB_ANALYTICS_BEACON_SRC];
  if (nonce) {
    sources.push(`'nonce-${nonce}'`);
  }
  if (widgetHost) {
    sources.push(SITE_REP_WIDGET_HOST);
  }
  return `script-src ${sources.join(" ")}`;
}

function securityHeadersForRequest(
  responseHeaders: Headers,
  request?: Request,
  nonce?: string,
): Record<string, string> {
  if (!request || !isHtmlResponse(responseHeaders)) {
    return SECURITY_HEADERS;
  }

  const widgetHost = canUseSiteRepWidgetScript(request);
  // Non-HTML or no-nonce: the baseline CSP (no 'unsafe-inline', no nonce) is
  // correct — there are no inline scripts to authorize. Only HTML responses
  // that carry inline scripts need the nonce injected.
  if (!nonce && !widgetHost) {
    return SECURITY_HEADERS;
  }

  const csp = SECURITY_HEADERS["content-security-policy"];
  let patched = csp.replace(BASE_SCRIPT_SRC, buildScriptSrc(nonce, widgetHost));
  if (widgetHost) {
    patched = patched.replace(CONNECT_SRC, CONNECT_SRC_WITH_SITE_REP_WIDGET);
  }
  return {
    ...SECURITY_HEADERS,
    "content-security-policy": patched,
  };
}

export function withSecurityHeaders(response: Response, request?: Request, nonce?: string): Response {
  // Clone headers so we don't mutate a potentially-immutable response.
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeadersForRequest(headers, request, nonce))) {
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
      // An explicitly-set cache-control on the app response wins. Any page
      // that pins itself to a browser-only variant (e.g. one carrying
      // visitor-specific state that a shared cache must never replay) gets
      // that policy honored as-is. Security headers above still apply.
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
