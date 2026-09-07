const PRIMARY_HOST = "0509.io";
const APEX_REDIRECT_HOSTS = new Set(["0509.in", "www.0509.in", "www.0509.io"]);
const API_REDIRECT_HOSTS = new Set(["api.0509.in"]);
const REDIRECT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PROVIDER_CHALLENGE_PATHS = new Set(["/api/delivery-status/whatsapp"]);

export function primaryDomainRedirect(request: Request): Response | null {
  if (!REDIRECT_METHODS.has(request.method.toUpperCase())) {
    return null;
  }

  const url = new URL(request.url);
  if (PROVIDER_CHALLENGE_PATHS.has(url.pathname)) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  // Keep the canonical www health probe on the responding Worker so release
  // gates prove that alias instead of following its ordinary apex redirect.
  if (hostname === "www.0509.io" && url.pathname === "/api/health") {
    return null;
  }
  if (!APEX_REDIRECT_HOSTS.has(hostname) && !API_REDIRECT_HOSTS.has(hostname)) {
    return null;
  }

  url.protocol = "https:";
  url.hostname = API_REDIRECT_HOSTS.has(hostname) ? `api.${PRIMARY_HOST}` : PRIMARY_HOST;

  return new Response(null, {
    status: 308,
    headers: {
      "cache-control": authPathHasQueryCredential(url) ? "no-store" : "public, max-age=3600",
      location: url.toString(),
    },
  });
}

function authPathHasQueryCredential(url: URL) {
  return (
    (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/auth/")) &&
    url.search.length > 0
  );
}
