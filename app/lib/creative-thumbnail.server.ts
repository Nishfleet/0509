/**
 * WP-10: persist saved-ad creative thumbnails to R2 so collection boards
 * keep rendering after fbcdn signatures expire.
 *
 * Only runs on explicit collection save — never on public search.
 * Fetch path reuses the same public-URL / SSRF guards as creative-text.
 */

import {
  contentLengthExceeds,
  readResponseBytesWithinLimit,
} from "~/lib/bounded-response.server";
import type { AppEnv } from "~/lib/env.server";
import { fetchWithTimeout, releaseFetchTimeout } from "~/lib/fetch-timeout.server";
import { resolvePublicHttpUrl, resolvePublicRedirectUrl } from "~/lib/public-url.server";
import type { AdRecord } from "~/lib/types";

export const CREATIVE_ARTIFACT_KEY_PREFIX = "creatives/";
export const MAX_SAVED_CREATIVE_IMAGE_BYTES = 2_000_000;
const MAX_CREATIVE_FETCH_REDIRECTS = 5;
const CREATIVE_RESOURCE_FETCH_TIMEOUT_MS = 12_000;
const META_AD_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function creativeArtifactObjectKey(metaAdId: string): string | null {
  const id = metaAdId.trim();
  if (!META_AD_ID_PATTERN.test(id) || id.includes("..") || id.includes("/")) {
    return null;
  }
  return `${CREATIVE_ARTIFACT_KEY_PREFIX}${id}`;
}

export function parseCreativeArtifactPathname(pathname: string): string | null {
  const match = pathname.match(/^\/artifacts\/creatives\/([^/]+)$/);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function buildCreativeArtifactUrl(env: AppEnv, metaAdId: string): string | null {
  if (!creativeArtifactObjectKey(metaAdId)) {
    return null;
  }
  const base = (env.APP_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim() || "https://0509.io").replace(
    /\/+$/,
    "",
  );
  return `${base}/artifacts/creatives/${encodeURIComponent(metaAdId.trim())}`;
}

/**
 * Fetch the hotlinked creative (SSRF-guarded), store in R2, return a durable
 * app-origin URL. On any failure return the original URL unchanged.
 */
export async function persistCreativeThumbnailForSavedAd(
  env: AppEnv,
  ad: Pick<AdRecord, "metaAdId" | "creativeImageUrl" | "adSnapshotUrl">,
): Promise<string | null> {
  const original = ad.creativeImageUrl?.trim() || null;
  if (!original || !/^https:\/\//i.test(original)) {
    return original;
  }

  // Already a durable artifact URL — do not re-fetch ourselves.
  if (original.includes("/artifacts/creatives/")) {
    return original;
  }

  const objectKey = creativeArtifactObjectKey(ad.metaAdId);
  if (!objectKey || !env.LANDING_PAGE_ARTIFACTS) {
    return original;
  }

  try {
    // Skip re-upload when object already exists (re-save same ad).
    const existing = await env.LANDING_PAGE_ARTIFACTS.head(objectKey);
    if (existing) {
      return buildCreativeArtifactUrl(env, ad.metaAdId) ?? original;
    }

    const payload = await fetchGuardedCreativeImage(original, ad.adSnapshotUrl ?? original);
    if (!payload) {
      return original;
    }

    await env.LANDING_PAGE_ARTIFACTS.put(objectKey, payload.bytes, {
      httpMetadata: {
        contentType: payload.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        sourceUrl: original.slice(0, 1024),
        metaAdId: ad.metaAdId.slice(0, 128),
      },
    });

    return buildCreativeArtifactUrl(env, ad.metaAdId) ?? original;
  } catch {
    return original;
  }
}

export async function serveCreativeArtifact(
  env: AppEnv,
  request: Request,
  metaAdId: string,
): Promise<Response | null> {
  const objectKey = creativeArtifactObjectKey(metaAdId);
  if (!objectKey || !env.LANDING_PAGE_ARTIFACTS) {
    return null;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const object = await env.LANDING_PAGE_ARTIFACTS.get(objectKey);
  if (!object) {
    return new Response("Not Found", { status: 404 });
  }

  // MINOR: only serve raster image types — never SVG (scriptable).
  const rawType = (object.httpMetadata?.contentType ?? "image/jpeg").toLowerCase();
  const mediaType = rawType.split(";")[0]?.trim() ?? "";
  const allowedRaster = new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ]);
  if (!allowedRaster.has(mediaType)) {
    return new Response("Unsupported Media Type", { status: 415 });
  }

  const headers = new Headers();
  headers.set("content-type", mediaType === "image/jpg" ? "image/jpeg" : mediaType);
  headers.set(
    "cache-control",
    object.httpMetadata?.cacheControl ?? "public, max-age=31536000, immutable",
  );
  headers.set("x-content-type-options", "nosniff");
  if (object.etag) {
    headers.set("etag", object.etag);
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.body, { status: 200, headers });
}

async function fetchGuardedCreativeImage(
  imageUrl: string,
  referer: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const response = await fetchPublicCreativeResource(imageUrl, {
    "user-agent": "0509-bot/1.0 (+https://0509.io)",
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    referer,
  });
  if (!response?.ok) {
    if (response) releaseFetchTimeout(response);
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.toLowerCase().startsWith("image/")) {
    releaseFetchTimeout(response);
    return null;
  }

  if (contentLengthExceeds(response.headers, MAX_SAVED_CREATIVE_IMAGE_BYTES)) {
    releaseFetchTimeout(response);
    return null;
  }

  const bytes = await readResponseBytesWithinLimit(response, MAX_SAVED_CREATIVE_IMAGE_BYTES);
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }

  return { bytes, contentType };
}

// Same SSRF contract as creative-text.server.ts: every hop must resolve to
// a public internet address or the Worker refuses the fetch.
async function fetchPublicCreativeResource(
  url: string,
  headers: Record<string, string>,
): Promise<Response | null> {
  let currentUrl = await resolvePublicHttpUrl(url);

  for (
    let redirects = 0;
    currentUrl && redirects <= MAX_CREATIVE_FETCH_REDIRECTS;
    redirects += 1
  ) {
    const response = await fetchWithTimeout(
      currentUrl.toString(),
      {
        redirect: "manual",
        headers,
      },
      { timeoutMs: CREATIVE_RESOURCE_FETCH_TIMEOUT_MS },
    );

    if (response.status >= 300 && response.status < 400) {
      const redirected = resolvePublicRedirectUrl(response.headers.get("location"), currentUrl);
      releaseFetchTimeout(response);
      currentUrl = redirected ? await resolvePublicHttpUrl(redirected) : null;
      continue;
    }

    return response;
  }

  return null;
}
