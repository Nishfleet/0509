import { matchRoutes } from "react-router";

import { isBuyerSurfaceLocaleId } from "../app/lib/locale-markets";
import type { AgnosticRouteObject } from "react-router";

/**
 * Tiny purpose-built 404 (issue #2967).
 *
 * The React Router route tree ends in a `*` catch-all (`routes/not-found.tsx`)
 * whose score loses to every specific route, so a GET/HEAD request reaches it
 * exactly when nothing else in the route tree matches. Matching the same tree
 * — minus that catch-all — with `matchRoutes` gives us an exact, cheap decision
 * for "this path is a 404" BEFORE the SSR handler runs, so stray-URL requests
 * (bots, typos, stale asset probes) never pay for the root loader, the SSR
 * render, the 256 KB root stylesheet, or the hydration bundle. The in-app
 * not-found page stays untouched for client-side navigation and for every
 * route that legitimately 404s from its own loader.
 *
 * The splat and nested-splat exception: only leaf entries whose path is exactly
 * "*" are stripped ("api/auth/*" is a real route prefix, not a 404 fallback),
 * and children of the splat don't exist in this app's config.
 */

/**
 * Page under deliberate 1 KB: no external requests, no scripts (the CSP nonce
 * is irrelevant — nothing inline executes), no fonts, no stylesheet link. Any
 * asset would re-open the payload hole #2967 closes.
 */
export const TINY_NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Page not found | Five to Nine</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#fff;color:#101014;display:grid;place-items:center;min-height:100vh}main{text-align:center;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem;color:#5b21b6}p{margin:0 0 1.25rem}a{color:#5b21b6}</style>
</head>
<body><main><h1>Page not found</h1><p>The page you asked for does not exist.</p><a href="/">Back to Five to Nine</a></main></body>
</html>
`;

/**
 * `serverBuild.routes` is the React Router route MANIFEST — a flat
 * `Record<id, {id, parentId, path, index, …}>` — not the nested array
 * `matchRoutes` expects. Rebuild the tree from `parentId` links. Entries
 * keep only the fields matching needs (path/index/caseSensitive); the
 * manifest's own enumeration order already matches route-config order.
 */
function manifestToRouteObjects(
  routes: AgnosticRouteObject[] | Record<string, { id?: string; parentId?: string; path?: string; index?: boolean; caseSensitive?: boolean }>,
): AgnosticRouteObject[] {
  if (Array.isArray(routes)) return routes;
  type ManifestEntry = { parentId?: string; path?: string; index?: boolean; caseSensitive?: boolean };
  const nodes = new Map<string, AgnosticRouteObject & { children: AgnosticRouteObject[] }>();
  for (const [id, r] of Object.entries(routes as Record<string, ManifestEntry>)) {
    nodes.set(id, {
      path: r.path,
      index: r.index === true,
      caseSensitive: r.caseSensitive,
      children: [],
    } as AgnosticRouteObject & { children: AgnosticRouteObject[] });
  }
  const roots: AgnosticRouteObject[] = [];
  for (const [id, r] of Object.entries(routes as Record<string, ManifestEntry>)) {
    const node = nodes.get(id)!;
    const parent = r.parentId && nodes.get(r.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function stripNotFoundSplat(routes: AgnosticRouteObject[]): AgnosticRouteObject[] {
  return routes
    .filter((entry) => entry.path !== "*")
    .map((entry) =>
      Array.isArray(entry.children)
        ? { ...entry, children: stripNotFoundSplat(entry.children) }
        : entry,
    );
}

function thrownNotFoundParams(params: Record<string, string | undefined>): boolean {
  // The only param-only swallower in the tree is `route(":locale", ...)`
  // (app/routes/$locale.tsx): its loader throws 404 for anything that is not
  // a buyer-surface locale id. Replicating that single check keeps the
  // decision exact without re-running loaders; every other unmatched shape
  // (multi-segment junk, stale asset probes) is already splat-only.
  const keys = Object.keys(params);
  return keys.length === 1 && keys[0] === "locale" && !isBuyerSurfaceLocaleId(params.locale);
}

// Cache the stripped tree per imported build: the routes manifest is stable
// at runtime (the server build module import is cached), so the manifest→tree
// conversion and recursive filter run once per isolate, not once per request.
const strippedRoutesCache = new WeakMap<object, AgnosticRouteObject[]>();

function routesWithoutNotFoundSplat(
  routes: AgnosticRouteObject[] | Record<string, unknown>,
): AgnosticRouteObject[] {
  const cached = strippedRoutesCache.get(routes as object);
  if (cached) return cached;
  const stripped = stripNotFoundSplat(
    manifestToRouteObjects(routes as AgnosticRouteObject[]),
  );
  strippedRoutesCache.set(routes as object, stripped);
  return stripped;
}

/**
 * True when the React Router tree would serve the `not-found` catch-all for
 * this pathname — i.e. routing matched nothing but the splat.
 */
export function routesCatchAllForPath(
  routes: AgnosticRouteObject[] | Record<string, unknown>,
  pathname: string,
  basename = "/",
): boolean {
  const matches = matchRoutes(
    routesWithoutNotFoundSplat(routes),
    pathname,
    basename ?? "/",
  );
  if (matches === null) return true;
  // A `:locale` match with a non-locale segment throws 404 in its loader —
  // same outcome, same payload hole.
  const leaf = matches[matches.length - 1];
  return thrownNotFoundParams(leaf?.params ?? {});
}

/**
 * The static 404 document response for a path the route tree does not match.
 * 404 status is preserved (same contract as the SSR not-found route) and the
 * response stays cacheable for a short window since the body is path-independent.
 */
export function tinyNotFoundResponse(request: Request): Response {
  return new Response(request.method === "HEAD" ? null : TINY_NOT_FOUND_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-f9-tiny-404": "1",
    },
  });
}
