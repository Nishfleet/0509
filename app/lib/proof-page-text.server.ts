import type { AppEnv } from "~/lib/env.server";
import { isValidProofPageTextKey } from "~/lib/proof-page-text";

/**
 * Serves stored landing-page HTML from R2 at `/artifacts/page-text/<key>`
 * as `text/plain` (never `text/html`) so the captured page cannot run
 * scripts in the viewer's browser. Wired in `workers/app.ts` next to
 * proof-screenshot serving.
 */

export async function serveProofPageText(
  env: AppEnv,
  request: Request,
  key: string,
): Promise<Response | null> {
  if (!isValidProofPageTextKey(key)) {
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

  const headers = new Headers();
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set(
    "cache-control",
    object.httpMetadata?.cacheControl ?? "public, max-age=31536000, immutable",
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", 'inline; filename="page.txt"');
  headers.set("content-security-policy", "default-src 'none'");
  if (object.etag) {
    headers.set("etag", object.etag);
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.body, { status: 200, headers });
}
