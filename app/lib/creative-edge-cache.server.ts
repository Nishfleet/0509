/**
 * Issue #2393: `/creative/:id` — a same-origin edge-cached copy of a captured
 * ad creative.
 *
 * The scraped creative image is a hotlinked `*.fbcdn.net` URL carrying a signed
 * `oe=` expiry (~4 days after capture). A public `/ads/:domain` page stays
 * indexable for 7–30 days, so after expiry every creative on an SEO landing
 * page 410s: dead requests, a broken LCP, and an extra third-party TLS
 * connection to fbcdn even while the signature is alive.
 *
 * This module owns both halves of the fix:
 *
 *  1. `primeCreativeEdgeCache` — runs at capture time inside the capture
 *     pipeline's existing `waitUntil`, so the Cache API entry is filled while
 *     the signature is still valid. Without this, a first view after day 4
 *     could never succeed.
 *  2. `serveCreativeResource` — the `/creative/:id` route handler. It resolves
 *     the stored URL from D1 by ad id, and fetches it only when the host ends
 *     in `.fbcdn.net`. On a cache miss it tries the stored URL once; a fbcdn
 *     4xx marks the creative dead and serves a cached 1x1 placeholder so the
 *     page renders a frame instead of a broken-image icon. A 5xx or a timeout
 *     is NOT dead — it serves the placeholder uncached and tries again later.
 *
 * Security contract (judge edit, binding):
 *  - the URL is never read from query params — only from the D1 row for `:id`;
 *  - unknown ids 404;
 *  - a stored URL whose host does not end in `.fbcdn.net` is refused.
 */

import {
  readResponseBytesWithinLimit,
} from "~/lib/bounded-response.server";
import {
  isEdgeCacheableCreativeUrl,
  normalizeCreativeId,
} from "~/lib/creative-edge-cache-url";
import { bindD1Named } from "~/lib/d1-bind.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import {
  getCreativeImageByHash,
  lookupStoredCreativeHash,
  persistCreativeHash,
  storeCreativeImageByHash,
} from "~/lib/creative-r2-hash.server";

export const CREATIVE_CACHE_NAME = "creative-v1";
/**
 * 30 days, per the ticket. Cache API entries are evictable before their TTL
 * and there is no eviction control here, so a miss is expected and costs one
 * guarded re-fetch (the *dead*-creative placeholder is what stops a gone id
 * from re-fetching forever). If eviction turns out to cause visible misses
 * before day 30, the fix is the R2-on-capture follow-up named on issue #2393 —
 * do not widen this route to cover it.
 */
export const CREATIVE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAX_EDGE_CREATIVE_BYTES = 2_000_000;
const CREATIVE_FETCH_TIMEOUT_MS = 12_000;
const MAX_CREATIVE_FETCH_REDIRECTS = 5;

/** The raster types we are willing to store and re-serve. Never SVG. */
const ALLOWED_RASTER_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/**
 * A 1x1 transparent PNG. Served (and cached) when fbcdn answers 4xx, so the
 * creative renders an empty frame rather than a broken-image icon and no
 * further request ever reaches fbcdn for that id.
 */
export const DEAD_CREATIVE_PLACEHOLDER_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** Parse `/creative/:id`; returns the id or null when the path is not ours. */
export function parseCreativeResourcePathname(pathname: string): string | null {
  const match = pathname.match(/^\/creative\/([^/]+)$/);
  if (!match) {
    return null;
  }
  try {
    return normalizeCreativeId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/**
 * The stored creative URL for an ad id, or null when the ad has none.
 * Reads `$.creativeImageUrl` out of `ad.raw_json` — the same column and JSON
 * path `upsertAd` writes, so there is no second source of truth.
 */
export async function lookupStoredCreativeUrl(
  env: AppEnv,
  creativeId: string,
): Promise<string | null> {
  if (!env.DB || !normalizeCreativeId(creativeId)) {
    return null;
  }
  const result = await bindD1Named(
    env.DB.prepare(
      "SELECT json_extract(raw_json, '$.creativeImageUrl') AS creative_image_url FROM ad WHERE id = ? LIMIT 1",
    ),
    [["adId", creativeId]],
  ).first<{ creative_image_url: string | null }>();
  const value = result?.creative_image_url?.trim() ?? "";
  return value || null;
}

/**
 * Resolve a stored URL to something we are willing to fetch, or null.
 * Rejects non-https, non-`.fbcdn.net`, and malformed URLs.
 */
export function resolveFetchableCreativeUrl(stored: string | null): string | null {
  const raw = stored?.trim() ?? "";
  if (!isEdgeCacheableCreativeUrl(raw)) {
    return null;
  }
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

function creativeCacheKey(creativeId: string): string {
  return `https://creative.0509.internal/${encodeURIComponent(creativeId)}`;
}

/**
 * `Uint8Array` is not itself a `BodyInit` under the Worker lib types (it is a
 * `BufferSource`, which `BodyInit` does not include), so the bytes are copied
 * into a plain `ArrayBuffer` view before being handed to `Response`.
 */
function imageBody(bytes: Uint8Array): BodyInit {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function imageResponse(body: BodyInit | null, contentType: string, status = 200): Response {  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${CREATIVE_CACHE_TTL_SECONDS}, immutable`,
      "x-content-type-options": "nosniff",
    },
  });
}

function placeholderResponse(): Response {
  return imageResponse(imageBody(DEAD_CREATIVE_PLACEHOLDER_PNG), "image/png");
}

/**
 * A fbcdn answer, classified. Only `dead` (a real 4xx) may be cached: a 5xx, a
 * timeout, or a redirect loop is transient, and caching those for 30 days with
 * `immutable` would blank one ad's creative for a month off a single wobble.
 */
type CreativeFetchOutcome =
  | { kind: "ok"; bytes: Uint8Array; contentType: string }
  | { kind: "dead" }
  | { kind: "transient" };

/**
 * Fetch one fbcdn creative, following fbcdn-internal redirects up to the cap
 * and re-applying the `.fbcdn.net` host gate on EVERY hop, so a redirect can
 * never carry the fetch off fbcdn. Single pass, no retry loop.
 */
async function fetchFbcdnCreative(url: string): Promise<CreativeFetchOutcome> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_CREATIVE_FETCH_REDIRECTS; hop += 1) {
    if (!isEdgeCacheableCreativeUrl(currentUrl)) {
      return { kind: "transient" };
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        currentUrl,
        {
          redirect: "manual",
          headers: {
            "user-agent": "0509-bot/1.0 (+https://0509.io)",
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
        },
        { timeoutMs: CREATIVE_FETCH_TIMEOUT_MS },
      );
    } catch {
      // Network error, abort, or 12s timeout — never a dead creative.
      return { kind: "transient" };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      releaseFetchTimeout(response);
      if (!location) {
        return { kind: "transient" };
      }
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return { kind: "transient" };
      }
      continue;
    }

    if (response.status >= 400 && response.status < 500) {
      // The signature expired, or the asset is gone. Permanently dead.
      releaseFetchTimeout(response);
      return { kind: "dead" };
    }

    if (!response.ok) {
      releaseFetchTimeout(response);
      return { kind: "transient" };
    }

    const contentType =
      (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_RASTER_TYPES.has(contentType)) {
      releaseFetchTimeout(response);
      return { kind: "transient" };
    }

    // The shared streaming reader caps the read, so a chunked fbcdn response
    // with no content-length cannot be buffered past the limit. It owns the
    // timeout release.
    const bytes = await readResponseBytesWithinLimit(response, MAX_EDGE_CREATIVE_BYTES);
    if (!bytes) {
      return { kind: "transient" };
    }
    return {
      kind: "ok",
      bytes,
      contentType: contentType === "image/jpg" ? "image/jpeg" : contentType,
    };
  }

  // Redirect cap exhausted.
  return { kind: "transient" };
}

/**
 * Capture-time fill. Called from the capture pipeline's existing `waitUntil`
 * while the fbcdn signature is still valid, so day-30 readers get a cache HIT
 * instead of an expired URL. Never throws: a failed prime degrades to the
 * existing route-time miss path.
 */
export async function primeCreativeEdgeCache(env: AppEnv, adId: string): Promise<boolean> {
  const id = normalizeCreativeId(adId);
  // No Cache API (local node tests, a non-Worker caller): the prime is a
  // no-op. The route still fetches on demand, so the page renders either way.
  if (!id || typeof caches === "undefined") {
    return false;
  }

  try {
    const stored = await lookupStoredCreativeUrl(env, id);
    const resolved = resolveFetchableCreativeUrl(stored);
    if (!resolved) {
      return false;
    }

    const cache = await caches.open(CREATIVE_CACHE_NAME);
    const key = creativeCacheKey(id);
    if (await cache.match(key)) {
      return true;
    }

    const outcome = await fetchFbcdnCreative(resolved);
    if (outcome.kind === "transient") {
      // Do not write a 30-day immutable placeholder for a wobble.
      return false;
    }
    // Issue #2981: mirror the bytes into R2 under their content hash while
    // we have them, so the creative outlives its fbcdn URL.
    if (outcome.kind === "ok") {
      try {
        const stored = await storeCreativeImageByHash(env, outcome.bytes, outcome.contentType);
        if (stored) {
          await persistCreativeHash(env, id, stored);
        }
      } catch {
        // A failed mirror must not fail the prime or the cache fill below.
      }
    }
    // A dead creative is cached as the placeholder, so no later request
    // re-hits fbcdn. There is no retry loop here or anywhere downstream.
    await cache.put(
      key,
      outcome.kind === "ok"
        ? imageResponse(imageBody(outcome.bytes), outcome.contentType)
        : placeholderResponse(),
    );
    return outcome.kind === "ok";
  } catch {
    return false;
  }
}

/** A HEAD reply must keep the same caching headers as the GET it mirrors. */
function headOf(response: Response): Response {
  return new Response(null, { status: response.status, headers: response.headers });
}

/**
 * `/creative/:id` handler. Returns null when the path is not a creative route
 * (so the caller falls through), a 404 for an unknown or unfetchable id, and
 * an image response otherwise.
 *
 * Never throws: the Cache API and D1 both sit on a public request path, and a
 * cache or lookup failure must degrade to a render, not a 500.
 */
export async function serveCreativeResource(
  env: AppEnv,
  request: Request,
  creativeId: string,
): Promise<Response | null> {
  const id = normalizeCreativeId(creativeId);
  if (!id) {
    return new Response("Not Found", { status: 404 });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const key = creativeCacheKey(id);
    const cache = typeof caches === "undefined" ? null : await caches.open(CREATIVE_CACHE_NAME);

    // Issue #2981: the content-hash R2 copy is checked BEFORE the Cache API.
    // The Cache API entry carries a 30-day immutable TTL, so a creative whose
    // bytes are already hash-keyed would otherwise be masked by a warm cache
    // entry that still points at (or was fetched from) a rotting fbcdn URL;
    // and the hash lookup is what lets a post-expiry first view resolve at all.
    // A hash hit is the cheapest correct answer, so it is tested first and
    // used to re-fill the Cache API entry for request-speed.
    if (env.DB) {
      try {
        const storedHash = await lookupStoredCreativeHash(env, id);
        const image = await getCreativeImageByHash(env, storedHash);
        if (image) {
          const r2Response = imageResponse(imageBody(image.bytes), image.contentType);
          await cache?.put(key, r2Response.clone());
          return request.method === "HEAD" ? headOf(r2Response) : r2Response;
        }
      } catch {
        // A failed R2 read degrades to the cache / fetch path below.
      }
    }

    const cached = await cache?.match(key);
    if (cached) {
      return request.method === "HEAD" ? headOf(cached) : cached;
    }

    if (!env.DB) {
      return new Response("Not Found", { status: 404 });
    }

    const stored = await lookupStoredCreativeUrl(env, id);
    const resolved = resolveFetchableCreativeUrl(stored);
    if (resolved === null) {
      return new Response("Not Found", { status: 404 });
    }

    const outcome = await fetchFbcdnCreative(resolved);
    if (outcome.kind === "transient") {
      // Serve the placeholder without caching it or claiming 30-day
      // freshness — the next request is free to try fbcdn again.
      const transient = new Response(imageBody(DEAD_CREATIVE_PLACEHOLDER_PNG), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=60",
          "x-content-type-options": "nosniff",
        },
      });
      return request.method === "HEAD" ? headOf(transient) : transient;
    }

    const response =
      outcome.kind === "ok"
        ? imageResponse(imageBody(outcome.bytes), outcome.contentType)
        : placeholderResponse();

    // Issue #2981: self-healing backfill — a request that still resolves the
    // fbcdn URL takes the bytes and lands them in R2 by content hash, so this
    // is the last request that ever depends on the signed URL being alive.
    if (outcome.kind === "ok") {
      // Both halves are idempotent; their failure paths return false/null, so
      // a failed mirror must not fail the serve that just succeeded.
      const stored = await storeCreativeImageByHash(env, outcome.bytes, outcome.contentType);
      if (stored) {
        await persistCreativeHash(env, id, stored);
      }
    }

    // Cache even the placeholder: the dead creative must not be re-fetched.
    await cache?.put(key, response.clone());
    return request.method === "HEAD" ? headOf(response) : response;
  } catch {
    // A cache or D1 failure is not a reason to fail the page. Fall through to
    // the raw capture is impossible here, so answer 404 and let AdCreative's
    // own onError mock take over.
    return new Response("Not Found", { status: 404 });
  }
}
