import { canUseSiteRepWidgetScript } from "../app/lib/siterep-widget";

// Baseline security headers applied to every response. CSP allows Google Fonts
// (used in app/root.tsx) and inline <script>/<style> emitted by React Router's
// <Scripts /> / <Links /> during SSR hydration. Tighten to nonces in a follow-up.
const BASE_SCRIPT_SRC = "script-src 'self' 'unsafe-inline'";
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
    for (const [name, value] of Object.entries(HTML_NO_STORE_HEADERS)) {
      headers.set(name, value);
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
