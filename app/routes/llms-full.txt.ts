/**
 * Route registration for `/llms-full.txt` (issue #2043).
 *
 * The actual response is served by `workers/app.ts` BEFORE the React Router
 * handler runs — the worker intercepts the path and returns the D1-backed
 * Markdown feed directly. This route module exists so the path is *registered*
 * in the React Router manifest, which is what the sitemap route-registry
 * canary (`tests/sitemap.server.test.ts`) checks: every path in `SITEMAP_PATHS`
 * must resolve to a registered, non-splat route. Without this entry the
 * canary would (correctly) fail when `/llms-full.txt` is added to the sitemap.
 *
 * The loader below is unreachable in production (the worker returns first),
 * but a direct in-process request to the React Router tree (e.g. a test that
 * bypasses the worker) still gets an honest 404 instead of a silent 200 with
 * no body — the worker is the source of truth for the feed body.
 */

import type { LoaderFunctionArgs } from "react-router";

export async function loader(_args: LoaderFunctionArgs): Promise<Response> {
  return new Response("Not Found", { status: 404 });
}
