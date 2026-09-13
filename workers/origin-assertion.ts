// Origin / Sec-Fetch-Site assertion (issue #2986).
//
// Until now the CSRF posture of every state-changing request under /app/* and
// /api/v1/* rested on the session cookie's SameSite=Lax alone (deep code+live
// audit, 2026-09-11: zero occurrences of any csrf/Sec-Fetch-Site/Origin check
// in the repo). This module is the ONE worker-level gate the audit asked for:
// a state-changing request must present same-site evidence, or it 403s here —
// before the rate-limit gate, so a rejected request costs no D1 read/write.
//
// What passes (both directions tested in tests/worker-origin-assertion.test.ts):
//   1. Sec-Fetch-Site: same-origin or none (browser Fetch-Metadata evidence), OR
//   2. an Origin header whose scheme+host+port equals the request's own, OR
//   3. NEITHER header present — the no-Fetch-Metadata client class (curl,
//      undici, Python requests) that calls the documented Bearer-key
//      POST /api/v1/actions (docs/permission-matrix.md; the exact request
//      tests/api-v1.route.test.ts constructs). Those callers authenticate by
//      API key, carry no session cookie, and therefore have no CSRF surface;
//      403-ing them would break the documented customer API.
//
// Deliberately NOT allowed: Sec-Fetch-Site: same-site without a matching
// Origin. No in-repo caller talks cross-host today — the SPA calls its own
// origin, and api.0509.io serves only Bearer-key customers (who carry neither
// header). If a future caller needs cross-host same-site, that is a one-line
// widening here with its own failing test first.

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE"]);

export function enforceOriginAssertion(request: Request): Response | null {
  if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  const url = new URL(request.url);
  const { pathname } = url;
  const inScope =
    (pathname === "/app" || pathname.startsWith("/app/")) ||
    (pathname === "/api/v1" || pathname.startsWith("/api/v1/"));
  if (!inScope) {
    return null;
  }

  const secFetchSite = (request.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  if (secFetchSite === "same-origin" || secFetchSite === "none") {
    return null;
  }

  const origin = (request.headers.get("origin") ?? "").trim();
  if (origin) {
    try {
      // "a matching Origin": scheme+host+port must equal the request's own.
      if (new URL(origin).origin === url.origin) {
        return null;
      }
    } catch {
      // Malformed Origin header: fall through to the 403.
    }
  }

  if (!secFetchSite && !origin) {
    // No-Fetch-Metadata, no-Origin: the documented Bearer-key client class.
    return null;
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "origin_check_failed",
      message:
        "State-changing requests under /app/* and /api/v1/* must carry Sec-Fetch-Site: same-origin|none or a matching Origin header.",
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
