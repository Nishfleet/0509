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
 *     page renders a frame instead of a broken-image icon.
 *
 * Security contract (judge edit, binding):
 *  - the URL is never read from query params — only from the D1 row for `:id`;
 *  - unknown ids 404;
 *  - a stored URL whose host does not end in `.fbcdn.net` is refused.
 */

import {
  isEdgeCacheableCreativeUrl,
  normalizeCreativeId,
} from "~/lib/creative-edge-cache-url";
import { bindD1Named } from "~/lib/d1-bind.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";

export const CREATIVE_CACHE_NAME = "creative-v1";
export const CREATIVE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAX_EDGE_CREATIVE_BYTES = 2_000_000;
const CREATIVE_FETCH_TIMEOUT_MS = 12_000;
const FB_SIGNATURE_PARAM_PATTERN = /[?&]oe=/i;

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

interface ResolvedCreativeUrl {
  url: string;
  /** True when the stored URL still carries an `oe=` signature. */
  signed: boolean;
}

/**
 * Resolve a stored URL to something we are willing to fetch, or null.
 * Rejects non-https, non-`.fbcdn.net`, and malformed URLs.
 */
export function resolveFetchableCreativeUrl(stored: string | null): ResolvedCreativeUrl | null {
  const raw = stored?.trim() ?? "";
  if (!isEdgeCacheableCreativeUrl(raw)) {
    return null;
  }
  try {
    const url = new URL(raw);
    return { url: url.toString(), signed: FB_SIGNATURE_PARAM_PATTERN.test(url.search) };
  } catch {
    return null;
  }
}

function creativeCacheKey(creativeId: string): string {
  return `https://creative.0509.internal/${encodeURIComponent(creativeId)}`;
}

function imageResponse(body: BodyInit | null, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": `public, max-age=${CREATIVE_CACHE_TTL_SECONDS}, immutable`,
      "x-content-type-options": "nosniff",
    },
  });
}

function placeholderResponse(): Response {
  return imageResponse(DEAD_CREATIVE_PLACEHOLDER_PNG, "image/png");
}

async function readBytesWithinLimit(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > limit) {
    releaseFetchTimeout(response);
    return null;
  }
  const buffer = await response.arrayBuffer();
  releaseFetchTimeout(response);
  if (buffer.byteLength === 0 || buffer.byteLength > limit) {
    return null;
  }
  return new Uint8Array(buffer);
}

/**
 * Fetch one fbcdn creative, single attempt, no redirect following (a redirect
 * off fbcdn would escape the host gate). Returns null on anything unusable.
 */
async function fetchFbcdnCreative(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
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
    return null;
  }

  if (!response.ok) {
    releaseFetchTimeout(response);
    return null;
  }

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_RASTER_TYPES.has(contentType)) {
    releaseFetchTimeout(response);
    return null;
  }

  const bytes = await readBytesWithinLimit(response, MAX_EDGE_CREATIVE_BYTES);
  if (!bytes) {
    return null;
  }
  return { bytes, contentType: contentType === "image/jpg" ? "image/jpeg" : contentType };
}

/**
 * Capture-time fill. Called from the capture pipeline's existing `waitUntil`
 * while the fbcdn signature is still valid, so day-30 readers get a cache HIT
 * instead of an expired URL. Never throws: a failed prime degrades to the
 * existing route-time miss path.
 */
export async function primeCreativeEdgeCache(env: AppEnv, adId: string): Promise<boolean> {
  const id = normalizeCreativeId(adId);
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

    const fetched = await fetchFbcdnCreative(resolved.url);
    // A dead creative is cached as the placeholder, so no later request
    // re-hits fbcdn. There is no retry loop here or anywhere downstream.
    await cache.put(
      key,
      fetched ? imageResponse(fetched.bytes, fetched.contentType) : placeholderResponse(),
    );
    return Boolean(fetched);
  } catch {
    return false;
  }
}

/**
 * `/creative/:id` handler. Returns null when the path is not a creative route
 * (so the caller falls through), a 404 for an unknown or unfetchable id, and
 * an image response otherwise.
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

  const key = creativeCacheKey(id);
  const cache = typeof caches === "undefined" ? null : await caches.open(CREATIVE_CACHE_NAME);

  const cached = await cache?.match(key);
  if (cached) {
    return request.method === "HEAD" ? new Response(null, cached) : cached;
  }

  if (!env.DB) {
    return new Response("Not Found", { status: 404 });
  }

  const stored = await lookupStoredCreativeUrl(env, id);
  if (stored === null) {
    return new Response("Not Found", { status: 404 });
  }

  const resolved = resolveFetchableCreativeUrl(stored);
  if (!resolved) {
    return new Response("Not Found", { status: 404 });
  }

  const fetched = await fetchFbcdnCreative(resolved.url);
  const response = fetched
    ? imageResponse(fetched.bytes, fetched.contentType)
    : placeholderResponse();

  // Cache even the placeholder: the dead creative must not be re-fetched.
  await cache?.put(key, response.clone());
  return request.method === "HEAD" ? new Response(null, response) : response;
}
