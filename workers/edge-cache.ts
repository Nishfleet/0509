import {
  PUBLIC_CACHEABLE_HTML_PATHS,
  PUBLIC_CACHEABLE_HTML_PREFIXES,
} from "./security-headers";

// EDGE CACHE (issue #2950): serve anonymous public marketing HTML from
// Cloudflare's edge via the Cache API (caches.default). Before this, the
// worker set `cache-control: public, max-age=300` on those responses, but
// Cloudflare never caches text/html by default, so every visitor — and every
// cold-region first paint — ran the full Worker. The Cache API is the
// cluster-free, zone-config-free way to fill that gap from the Worker itself.
//
// Safety model (why each gate exists):
// - Cookie-free requests only. A signed-in (or auth-trailed) browser always
//   sends a Cookie header, and the root loader embeds the session in every
//   document — those responses must never be shared-cached. This is stricter
//   than the `vary: cookie` contract in security-headers.ts, but `Vary` is
//   not keyed on by the Cache API, so the missing-cookie gate is what makes
//   shared caching safe here.
// - Country-keyed cache keys. The marketing homepage embeds buyer-country
//   prices (loader: private, max-age=300) and picks the featured demo brand
//   by visitor home market. The Cache API has no Vary support, so each
//   (path, cf-ipcountry) pair is cached under its own synthetic key — a DE
//   EUR variant can never be replayed to a US visitor. `private` stays
//   browser-only in the returned response; only the edge copy (stored under
//   the country key) is shared, which is exactly what the country key
//   licenses.
// - Version epoch in the key. Every deploy gets a fresh Worker version id,
//   so a new deploy never replays HTML that references a previous deploy's
//   hashed asset manifest (the 2026-07-13 asset-skew incident class). The
//   5-minute TTL bound from PR #360 stays as a nested defense.
// - Store only 200, text/html, no set-cookie responses. Logged-in and
//   personalised routes never reach the store: their responses are
//   no-store HTML and their requests carry cookies.
//
// Observability: the Cache API does not populate Cloudflare's managed
// `cf-cache-status` header, so HIT/MISS is stamped explicitly in
// `x-0509-edge-cache` on every response served through this path. That is
// the proof surface for the deploy gate (scripts/check-live-public-home.mjs
// keeps asserting cache-control independently). Invalidation on deploy is
// implicit: the version epoch changes every deploy, so the old entries are
// simply never asked for again.

const EDGE_TTL_CAP_SECONDS = 300;

const EDGE_CACHE_HEADER = "x-0509-edge-cache";

function cacheablePathname(pathname: string): boolean {
  return (
    PUBLIC_CACHEABLE_HTML_PATHS.has(pathname) ||
    PUBLIC_CACHEABLE_HTML_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export function edgeCacheCountry(request: Request): string {
  return request.headers.get("cf-ipcountry")?.trim() || "xx";
}

function edgeCacheVersionId(env: { CF_VERSION_METADATA?: { id?: string | null } }): string {
  return env.CF_VERSION_METADATA?.id?.trim() || "local";
}

/** Synthetic cache-key URL: real URL + country + Worker version epoch. */
/**
 * Whether this request is eligible for the anonymous edge cache at all.
 * Exported for the unit tests; the worker asks it twice (lookup, store).
 */
export function isEdgeCacheableHtmlRequest(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const cookie = request.headers.get("cookie");
  if (cookie && cookie.trim() !== "") {
    return false;
  }
  return cacheablePathname(new URL(request.url).pathname);
}

/**
 * Whether this response is safe to store in the edge cache.
 * Country-variant marketing HTML (`private, max-age=300`) is allowed only
 * because the cache key carries the country (see isEdgeCacheableHtmlRequest +
 * edgeCacheCountry); no-store/no-cache must never be stored.
 */
export function isEdgeCacheableHtmlResponse(response: Response): boolean {
  if (response.status !== 200) {
    return false;
  }
  if (response.headers.has("set-cookie")) {
    return false;
  }
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
    return false;
  }
  const directives = response.headers.get("cache-control")?.toLowerCase() ?? "";
  if (!directives.includes("max-age")) {
    return false;
  }
  return !directives.includes("no-store") && !directives.includes("no-cache");
}

/** Edge TTL: the response's own max-age, capped at the 5-minute skew bound. */
export function parseEdgeCacheTtlSeconds(response: Response): number {
  const maxAge = response.headers
    .get("cache-control")
    ?.split(",")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith("max-age="))
    ?.slice("max-age=".length);
  const parsed = Number.parseInt(maxAge ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return EDGE_TTL_CAP_SECONDS;
  }
  return Math.min(parsed, EDGE_TTL_CAP_SECONDS);
}

export interface EdgeCacheRuntime {
  match(...args: Parameters<Cache["match"]>): Promise<Response | undefined>;
  put(...args: Parameters<Cache["put"]>): Promise<void>;
}

/**
 * Return the cached edge copy for an eligible request, or null on a miss (or
 * when the request is ineligible). `cache` is injected (caches.default in the
 * worker runtime, a stub in tests). Cache-key construction is version-pinned
 * so every deploy self-invalidates.
 */
export async function matchEdgeCache(
  request: Request,
  cache: EdgeCacheRuntime,
  versionId: string,
  country = edgeCacheCountry(request),
): Promise<Response | null> {
  if (!isEdgeCacheableHtmlRequest(request)) {
    return null;
  }
  const keyUrl = new URL(request.url);
  const cached = await cache.match(new Request(cacheKeyUrl(new URL(request.url), country, versionId), request));
  if (!cached) {
    return null;
  }
  return withEdgeCacheHeader(cached.clone(), "HIT");
}


/**
 * Build the synthetic cache-key URL for this request's (path, country,
 * version). Exported for tests.
 */
export function cacheKeyUrl(url: URL, country: string, versionId: string): string {
  url.searchParams.set("__edgec", country);
  url.searchParams.set("__edgev", versionId);
  return url.toString();
}

/**
 * Store an eligible, safe-to-share response in the edge cache and attach the
 * MISS stamp. The stored copy drops set-cookie (already gated above) and pins
 * `cache-control: public, max-age=<ttl>` so the Cache API honors the TTL
 * despite the original browser directive being the conservative `private`.
 * The response handed to the caller keeps its original headers untouched.
 */
export async function storeEdgeCache(
  request: Request,
  cache: EdgeCacheRuntime,
  versionId: string,
  response: Response,
  country = edgeCacheCountry(request),
): Promise<Response> {
  if (!isEdgeCacheableHtmlRequest(request) || !isEdgeCacheableHtmlResponse(response)) {
    return response;
  }
  const ttl = parseEdgeCacheTtlSeconds(response);
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set("cache-control", `public, max-age=${ttl}`);
  const stored = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const keyUrl = new URL(request.url);
  await cache.put(
    new Request(cacheKeyUrl(keyUrl, country, versionId), request),
    stored,
  );
  return withEdgeCacheHeader(response, "MISS");
}

function withEdgeCacheHeader(response: Response, value: "HIT" | "MISS"): Response {
  if (response.headers.has(EDGE_CACHE_HEADER)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(EDGE_CACHE_HEADER, value);
  return new Response(response.body, { status: response.status, headers });
}

export const EDGE_CACHE_PROOF_HEADER = EDGE_CACHE_HEADER;
