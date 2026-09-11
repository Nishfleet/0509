/**
 * Single path canonicalization rule (issue #2955): a public route is served
 * at exactly one URL shape — lowercase path, no trailing slash. React Router
 * matches route paths case-insensitively, so /Pricing and /pricing/ used to
 * serve byte-identical duplicates of /pricing, splitting PageRank across
 * three URLs. Every non-canonical public path now 301s to the canonical one;
 * the query string is preserved verbatim (query values are case-sensitive
 * data — search terms, share tokens, auth tickets).
 *
 * GET/HEAD only: a 301 rewrites the method to GET, so non-GET methods must
 * reach their handlers untouched.
 */

const CANONICAL_METHODS = new Set(["GET", "HEAD"]);

/**
 * Surfaces never path-canonicalized — each either carries a case-sensitive
 * segment (changing the case would break the resource) or is a
 * private/machine surface that is already noindex or robots-disallowed:
 *
 *   /assets/*      hashed Vite build files — the filename casing IS the key
 *   /artifacts/*   case-sensitive proof/creative object keys (R2/D1)
 *   /creative/*    case-sensitive edge-cache resource ids
 *   /share/*       the share token is a case-sensitive path segment
 *   /export/*      resource ids in the path
 *   /app/* /auth/* /team/*   private surfaces that can embed resource ids
 *   /api/*         machine surface (webhooks, health probes, e2e hooks)
 *   /unsubscribe, /.well-known/*   action/static surfaces
 *
 * The match is on the LOWERCASED path with a segment boundary, so /ASSETS/x
 * stays exempt (it already 404s) while /apple-touch-icon.png still
 * canonicalizes.
 */
const CANONICAL_EXEMPT_PREFIXES: readonly string[] = [
  "/api",
  "/app",
  "/assets",
  "/artifacts",
  "/auth",
  "/creative",
  "/export",
  "/share",
  "/team",
  "/unsubscribe",
  "/.well-known",
];

function isCanonicalExempt(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return CANONICAL_EXEMPT_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(`${prefix}/`),
  );
}

/** The one canonical form of a public path: lowercase, no trailing slash. */
export function canonicalPathFor(pathname: string): string {
  const lower = pathname.toLowerCase();
  if (lower === "/") {
    return lower;
  }
  const stripped = lower.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

export function canonicalPathRedirect(request: Request): Response | null {
  if (!CANONICAL_METHODS.has(request.method.toUpperCase())) {
    return null;
  }
  const url = new URL(request.url);
  if (isCanonicalExempt(url.pathname)) {
    return null;
  }
  const canonical = canonicalPathFor(url.pathname);
  if (canonical === url.pathname) {
    return null;
  }
  url.pathname = canonical;
  return new Response(null, {
    status: 301,
    headers: {
      "cache-control": "public, max-age=3600",
      location: url.toString(),
    },
  });
}
