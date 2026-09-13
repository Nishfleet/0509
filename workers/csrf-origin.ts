/**
 * Cross-site request guard (issue #2986): state-changing requests (POST/PUT/
 * DELETE) under the private cookie-authenticated surfaces /app/* (the logged
 * in app) and /api/v1/* (the customer API surface reached from the app) must
 * prove they are same-origin — via Sec-Fetch-Site: same-origin/none or an
 * Origin header matching the request origin — or they are 403'd. Until now
 * the only CSRF defense on these paths was the SameSite=Lax cookie attribute;
 * a forged cross-site POST had no worker-level backstop. This check runs in
 * the worker fetch() before any route state changes.
 *
 * Header priority (matches the audit contract):
 *   1. Sec-Fetch-Site same-origin or none → allow (modern browsers always
 *      send it; `none` covers user-initiated navigations).
 *   2. Origin header matching the request origin → allow (covers clients
 *      that omit Fetch Metadata).
 *   3. Otherwise 403.
 *
 * Machine-API exemption: requests under /api/v1/* carrying an Authorization
 * header are bearer-token clients (Five to Nine API keys), not cookie
 * sessions — CSRF is an ambient-credential attack and bearer headers are
 * never sent ambiently, so curl/SDK calls keep working without Origin or
 * Fetch Metadata headers. /app/* is cookie-session territory and has no
 * bearer clients, so it keeps the full same-origin requirement.
 */

const CSRF_GATED_METHODS = new Set(["POST", "PUT", "DELETE"]);

function isCsrfGatedPathname(pathname: string): boolean {
  return (
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    isApiV1Pathname(pathname)
  );
}

function isApiV1Pathname(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

export function isCsrfGatedRequest(request: Request): boolean {
  if (!CSRF_GATED_METHODS.has(request.method)) {
    return false;
  }
  return isCsrfGatedPathname(new URL(request.url).pathname);
}

/** Origin key as scheme//host:port — the identity an Origin header must match. */
function originKeyOf(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * The 403 for a state-changing cross-site request under /app/* or /api/v1/*,
 * or null when the request should proceed untouched.
 */
export function csrfOriginGuardResponse(request: Request): Response | null {
  if (!isCsrfGatedRequest(request)) {
    return null;
  }

  const onApiV1 = isApiV1Pathname(new URL(request.url).pathname);
  if (request.headers.has("authorization") && onApiV1) {
    return null;
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "none") {
    return null;
  }

  const originHeader = request.headers.get("origin");
  if (originHeader) {
    const requestKey = originKeyOf(request.url);
    const originKey = originKeyOf(originHeader);
    if (requestKey !== null && originKey === requestKey) {
      return null;
    }
  }

  return new Response(
    JSON.stringify({
      error: "cross-origin_request_rejected",
      message: "Cross-origin state-changing requests are not allowed.",
    }),
    {
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
