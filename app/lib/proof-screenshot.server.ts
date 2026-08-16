import type { AppEnv } from "~/lib/env.server";
import {
  isValidProofScreenshotKey,
  PROOF_SCREENSHOT_SERVED_TYPES,
} from "~/lib/proof-screenshot";

/**
 * Serves stored proof-capture screenshots from R2 at `/artifacts/proof/<key>`
 * (wired in `workers/app.ts` next to the creative-thumbnail artifacts).
 *
 * Mirrors the creative-thumbnail serving contract exactly: raster types only
 * (never SVG), immutable caching, etag passthrough, HEAD support, and a null
 * return when the bucket binding is missing so the caller's fallback runs.
 * The key shape is validated before touching R2, so this route can never
 * address an object outside `landing-pages/YYYY-MM-DD/`.
 */

export async function serveProofScreenshot(
  env: AppEnv,
  request: Request,
  key: string,
): Promise<Response | null> {
  if (!isValidProofScreenshotKey(key)) {
    return null;
  }
  if (!env.LANDING_PAGE_ARTIFACTS) {
    return null;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const object = await env.LANDING_PAGE_ARTIFACTS.get(key);
  if (!object) {
    return new Response("Not Found", { status: 404 });
  }

  const rawType = (object.httpMetadata?.contentType ?? "image/jpeg").toLowerCase();
  const mediaType = rawType.split(";")[0]?.trim() ?? "";
  if (!PROOF_SCREENSHOT_SERVED_TYPES.has(mediaType)) {
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
