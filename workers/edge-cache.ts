import {
  PUBLIC_CACHEABLE_HTML_PATHS,
  PUBLIC_CACHEABLE_HTML_PREFIXES,
} from "./security-headers";

// EDGE CACHE (issue #2950): serve anonymous public marketing HTML from
// Cloudflare's edge via the Cache API. Before this, the worker set
// `cache-control: public, max-age=300` on those responses (PR #360), but
// nothing ever consumed it: Cloudflare's managed cache does not store
// text/html without a Cache Rule (zone config, outside this repo), and the
// #2388 document cache was deleted by #2716 — so every visitor, and every
// cold-region first paint, ran the full Worker (smart placement even puts
// that render in a remote placement colo: cf-placement: remote-NRT while the
// eyeball edge is Hamburg).
//
// Why the #2716 detector (tests/edge-cache-removed.test.ts) stays satisfied —
// and why this is NOT #2388 again: #2716 deleted #2388's cache because
// #2348's per-response CSP nonces made it a silent no-op — "a cached document
// carries the whole response, headers included, so a nonce-bearing body would
// hand the same nonce to every visitor of a colo for the cache TTL". THIS
// cache re-introduces the document cache with the nonce problem solved
// structurally (the exact condition #2716's detector demands): the stored
// copy is a NONCE-FREE VARIANT. Its `script-src` keeps every host token
// ('self', the analytics beacon, the Site Rep widget host) but replaces the
// per-request `'nonce-…'` source with `'sha256-…'` content hashes computed
// from the very body being stored (inlineScriptHashSources +
// nonceFreeScriptSrc below). A hash-based policy authorises exactly the
// inline scripts that were rendered — header and body still agree by
// construction, but no secret-shaped token is ever shared between visitors:
// a content hash is a commitment, not a credential. The first anonymous
// visitor receives the SAME nonce-free variant, so there is exactly one
// anonymous document shape (and the nonce'd original is never served to a
// cacheable request at all).
//
// Safety model (why each gate exists):
// - Cookie-free requests only. A signed-in (or auth-trailed) browser always
//   sends a Cookie header, and the root loader embeds the session in every
//   document — those responses must never be shared-cached. This is stricter
//   than the `vary: cookie` contract in security-headers.ts, but the Cache
//   API does not key on Vary, so the missing-cookie gate is what makes shared
//   caching safe here.
// - Country-keyed cache keys. Any eligible page whose HTML varies by visitor
//   market (buyer-country copy, featured demo brand) is cached under its own
//   (path, cf-ipcountry) key — a DE variant can never be replayed to a US
//   visitor. Responses stamped `private, max-age=...` are still stored,
//   licensed by that country key; the stored copy is rewritten to
//   `public, max-age=...` because the edge copy IS shared.
// - Version epoch in the key. The version-metadata binding (wrangler.jsonc
//   version_metadata) gives every deploy a fresh version id, so a new deploy
//   never replays HTML that references a previous deploy's hashed asset
//   manifest (the 2026-07-13 asset-skew incident class). Invalidation on
//   deploy is implicit: old keys are simply never asked for again, and the
//   5-minute TTL bound from PR #360 stays as a nested defense.
// - Store only 200, text/html, no set-cookie, has-max-age responses.
//   Logged-in and personalised routes never reach the store: their responses
//   are no-store HTML and their requests carry cookies.
//
// Fail-open everywhere: a Cache API failure, an unreadable body, or a hash
// failure degrades to the plain (nonce'd) render, never a 5xx — same posture
// as the creative edge cache (issue #2393).
//
// Observability: the Cache API does not populate Cloudflare's managed
// `cf-cache-status` header, so HIT/MISS is stamped explicitly in
// `x-0509-edge-cache` on every response served through this path. That is the
// proof surface for the deploy gate (scripts/check-live-public-home.mjs
// asserts a second-request HIT and a nonce-free script-src) and the coupling
// test. (The name deliberately differs from #2388's retired `x-0509-cache`,
// which tests/edge-cache-removed.test.ts keeps out of the worker.)

const EDGE_TTL_CAP_SECONDS = 300;

const EDGE_CACHE_HEADER = "x-0509-edge-cache";

/** Named edge cache (issue #2950). Isolated from caches.default so the
 * document cache never fights any other default-cache tenant. */
export const EDGE_HTML_CACHE_NAME = "public-html-edge-v1";

/** The proof header the #2950 deploy gate asserts. */
export const EDGE_CACHE_PROOF_HEADER = EDGE_CACHE_HEADER;

function cacheablePathname(pathname: string): boolean {
  return (
    PUBLIC_CACHEABLE_HTML_PATHS.has(pathname) ||
    PUBLIC_CACHEABLE_HTML_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

export function edgeCacheCountry(request: Request): string {
  return request.headers.get("cf-ipcountry")?.trim() || "xx";
}

export function edgeCacheVersionId(env: {
  CF_VERSION_METADATA?: { id?: string | null };
}): string {
  return env.CF_VERSION_METADATA?.id?.trim() || "local";
}

/**
 * Whether this request participates in the anonymous edge cache at all.
 * GET and HEAD both participate: a stored copy always comes from a
 * FULL-BODY render (the worker routes eligible HEADs through a GET-ified
 * request because React Router 8 nulls HEAD bodies), so a HEAD can safely
 * serve the stored copy's headers. Exported for the unit tests; the worker
 * asks it three times (lookup, render-GETification, store).
 */
export function isEdgeCacheableHtmlRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  const cookie = request.headers.get("cookie");
  if (cookie && cookie.trim() !== "") {
    return false;
  }
  return cacheablePathname(new URL(request.url).pathname);
}

/**
 * Whether this response is safe to store in the edge cache. Country-variant
 * marketing HTML (`private, max-age=300`) is allowed only because the cache
 * key carries the country (see isEdgeCacheableHtmlRequest + edgeCacheCountry);
 * no-store/no-cache must never be stored.
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
 * Resolve the edge-cache storage. House pattern (creative-edge-cache #2393):
 * the Workers runtime exposes named caches through the `caches` global, while
 * the Node test harness (worker-csp-nonce, worker-public-content-signal) has
 * no `caches` at all — there the resolver returns null and the request flows
 * through exactly as before. The cache must never be a hard dependency.
 */
export async function edgeHtmlCacheStorage(): Promise<EdgeCacheRuntime | null> {
  if (typeof caches === "undefined") {
    return null;
  }
  return caches.open(EDGE_HTML_CACHE_NAME) as unknown as Promise<EdgeCacheRuntime>;
}

/**
 * Build the synthetic cache-key URL for this request's (path, country,
 * version). Exported for tests. Deploy invalidation is this function: a new
 * version id yields a new key, so the old entries are never asked for again.
 */
export function cacheKeyUrl(url: URL, country: string, versionId: string): string {
  url.searchParams.set("__edgec", country);
  url.searchParams.set("__edgev", versionId);
  return url.toString();
}

/** Lookup/put key: the synthetic URL alone. The Workers Cache API does not
 * honour Vary, and the cookie gate already guarantees anonymity, so the key
 * request carries no headers — the stored variant is exactly the anonymous
 * render. */
function edgeCacheKeyRequest(request: Request, country: string, versionId: string): Request {
  return new Request(cacheKeyUrl(new URL(request.url), country, versionId));
}

// --- Nonce-free variant (the #2716 condition) -------------------------------
//
// The stored copy must authorise its own inline scripts WITHOUT a nonce.
// CSP hash sources do exactly that: `'sha256-<base64>'` matches an inline
// script whose content hashes to the given digest. Because the hashes are
// computed from the exact body being stored, the stored header and the
// stored body agree by construction — and unlike a nonce, a hash is not a
// shared secret handed to every visitor; it is a commitment to specific
// bytes.

/** One tag's attribute string → name→value map, quote-aware (`>` inside a
 * quoted value must not end the scan). Values keep their raw form; callers
 * compare case-insensitively where it matters. */
function parseTagAttributes(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const pattern = /([^\s=/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  for (const match of raw.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!name || name === "/") {
      continue;
    }
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    attrs.set(name, value);
  }
  return attrs;
}

/**
 * The exact text bodies of the document's INLINE EXECUTABLE scripts — the
 * bytes a browser hashes for a CSP hash source. External scripts (a `src`
 * attribute) are covered by the host tokens in script-src and skipped; data
 * blocks (`type="application/ld+json"`, import maps, …) are never executed
 * and skipped. A script body is raw text (no entity decoding — that is how
 * the browser reads it too), so the captured bytes hash the same way.
 *
 * The open tag is scanned quote-aware (HTML tokenisation): a `>` inside a
 * quoted attribute value does not end the tag, so the captured body starts
 * where the browser's script content starts. The end tag permits the optional
 * whitespace HTML allows before the `>` (`</script >`); a browser treats that
 * as the script's end, so the extractor must too, or the missed end would
 * swallow the rest of the document into one "body" and hash the wrong bytes.
 */
export function extractInlineScriptBodies(html: string): string[] {
  const bodies: string[] = [];
  const openTag = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(openTag)) {
    const attrs = parseTagAttributes(match[1]);
    if (attrs.has("src")) {
      continue;
    }
    const type = (attrs.get("type") ?? "").trim().toLowerCase();
    if (type && type !== "module") {
      continue;
    }
    bodies.push(match[2]);
  }
  return bodies;
}

/** `'sha256-<base64>'` CSP source for every inline executable script body,
 * in document order. Deterministic for a given document. */
export async function inlineScriptHashSources(html: string): Promise<string[]> {
  const encoder = new TextEncoder();
  const sources: string[] = [];
  for (const body of extractInlineScriptBodies(html)) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
    let binary = "";
    for (const byte of new Uint8Array(digest)) {
      binary += String.fromCharCode(byte);
    }
    sources.push(`'sha256-${btoa(binary)}'`);
  }
  return sources;
}

/**
 * Rewrite a CSP header into the stored copy's nonce-free form: every
 * `'nonce-…'` source is removed from `script-src` and the content hashes are
 * appended. All other directives (and all non-nonce script-src tokens —
 * 'self', the beacon host, the widget host) pass through untouched.
 */
export function nonceFreeScriptSrc(cspHeader: string, hashSources: string[]): string {
  return cspHeader
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => {
      if (directive !== "script-src" && !directive.startsWith("script-src ")) {
        return directive;
      }
      const sources = directive
        .slice("script-src".length)
        .trim()
        .split(/\s+/)
        .filter((source) => source && !source.toLowerCase().startsWith("'nonce-"));
      return `script-src ${[...sources, ...hashSources].join(" ")}`.trimEnd();
    })
    .join("; ");
}

/** The stored copy's headers with the proof stamp. Stored copies are unstamped
 * (stamp-on-serve), so every HIT gets a fresh, truthful stamp. */
function stampedHeaders(response: Response, value: "HIT" | "MISS"): Headers {
  const headers = new Headers(response.headers);
  if (!response.headers.has(EDGE_CACHE_HEADER)) {
    headers.set(EDGE_CACHE_HEADER, value);
  }
  return headers;
}

/** Same headOf semantics as app/lib/creative-edge-cache.server.ts (#2393): a
 * HEAD reply keeps the cached GET's status and headers, minus the body. */
function headOf(status: number, statusText: string, headers: Headers): Response {
  return new Response(null, { status, statusText, headers });
}

/**
 * Return the cached edge copy for an eligible request, or null on a miss (or
 * when the request is ineligible, the cache is absent, or the Cache API
 * hiccups — fail-open). Cache-key construction is version-pinned so every
 * deploy self-invalidates.
 */
export async function matchEdgeCache(
  request: Request,
  cache: EdgeCacheRuntime | null,
  versionId: string,
  country = edgeCacheCountry(request),
): Promise<Response | null> {
  if (!cache || !isEdgeCacheableHtmlRequest(request)) {
    return null;
  }
  let cached: Response | undefined;
  try {
    cached = await cache.match(edgeCacheKeyRequest(request, country, versionId));
  } catch {
    return null;
  }
  if (!cached) {
    return null;
  }
  const headers = stampedHeaders(cached, "HIT");
  if (request.method === "HEAD") {
    return headOf(cached.status, cached.statusText, headers);
  }
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

/**
 * Store an eligible, safe-to-share response as its NONCE-FREE VARIANT and
 * return that variant to the caller (the MISS stamp; a bodyless headOf view
 * for HEAD requests). The body is buffered once and reused for the hash
 * computation, the stored copy, and the caller's reply, so the stored CSP
 * header authorises exactly the stored bytes. The stored copy drops
 * set-cookie and pins `cache-control: public, max-age=<ttl>` so the shared
 * edge copy honours the TTL even when the original browser directive was the
 * conservative `private`. Never throws: a body or hash failure returns the
 * ORIGINAL response untouched (still nonce'd — exactly today's behaviour) and
 * stores nothing; a put failure returns the nonce-free variant unstamped by
 * the cache (still a MISS in truth). No 5xx path exists.
 */
export async function storeEdgeCache(
  request: Request,
  cache: EdgeCacheRuntime | null,
  versionId: string,
  response: Response,
  country = edgeCacheCountry(request),
): Promise<Response> {
  if (
    !cache ||
    !isEdgeCacheableHtmlRequest(request) ||
    !isEdgeCacheableHtmlResponse(response)
  ) {
    return response;
  }
  const ttl = parseEdgeCacheTtlSeconds(response);
  let bodyText: string;
  try {
    bodyText = await response.clone().text();
  } catch {
    // Fail-open: an unreadable body is never stored, and the caller's own
    // (nonce'd) response is unaffected.
    return response;
  }
  let hashSources: string[];
  try {
    hashSources = await inlineScriptHashSources(bodyText);
  } catch {
    // Fail-open: without hashes we cannot build a policy that authorises the
    // body's inline scripts, so nothing is stored or transformed.
    return response;
  }
  const storedHeaders = new Headers(response.headers);
  storedHeaders.delete("set-cookie");
  storedHeaders.set("cache-control", `public, max-age=${ttl}`);
  const cspHeader = response.headers.get("content-security-policy");
  if (cspHeader) {
    storedHeaders.set(
      "content-security-policy",
      nonceFreeScriptSrc(cspHeader, hashSources),
    );
  }
  const stored = new Response(bodyText, {
    status: response.status,
    statusText: response.statusText,
    headers: storedHeaders,
  });
  try {
    await cache.put(edgeCacheKeyRequest(request, country, versionId), stored.clone());
  } catch {
    // Fail-open: the caller's response is unaffected; the next request simply
    // misses again, which the MISS stamp keeps visible.
  }
  const headers = stampedHeaders(stored, "MISS");
  if (request.method === "HEAD") {
    return headOf(stored.status, stored.statusText, headers);
  }
  return new Response(bodyText, {
    status: stored.status,
    statusText: stored.statusText,
    headers,
  });
}
