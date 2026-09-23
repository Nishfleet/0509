import type { RouteConfigEntry } from "@react-router/dev/routes";

import routes from "../routes";

export interface PublicSurface {
  readonly path: string;
  readonly indexable: boolean;
}

export interface ProtectedSurface {
  readonly path: string;
  readonly tree: boolean;
}

interface RegisteredRoute {
  readonly file: string;
  readonly url: string;
}

const PROTECTED_TREES: readonly string[] = ["/app", "/api", "/mcp"];

const PROTECTED_LEAVES: readonly string[] = ["/onboarding"];

const NOT_ADVERTISED: readonly string[] = ["/", "/*", "/s/:slug", "/design/brand-chips"];

const SEO_SURFACES: readonly string[] = ["/robots.txt", "/sitemap.xml"];

function normalizePath(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : `/${trimmed}`;
}

function routePathToUrl(routePath: string): string {
  return normalizePath(routePath.replace(/\/\*$/, ""));
}

export function isProtectedPath(value: string): boolean {
  const normalized = normalizePath(value);
  if (PROTECTED_LEAVES.includes(normalized)) return true;
  return PROTECTED_TREES.some((tree) => normalized === tree || normalized.startsWith(`${tree}/`));
}

export function registeredRoutes(
  entries: readonly RouteConfigEntry[],
  parentUrl = "",
): RegisteredRoute[] {
  const found: RegisteredRoute[] = [];
  for (const entry of entries) {
    const url = `${parentUrl}${routePathToUrl(entry.path ?? "")}`;
    if (entry.file) found.push({ file: entry.file.replace(/^routes\//, ""), url });
    if (entry.children) found.push(...registeredRoutes(entry.children, url));
  }
  return found;
}

const REGISTERED_ROUTES = registeredRoutes(routes);

const REGISTERED_URLS = REGISTERED_ROUTES.map(({ url }) => url);

export const PROTECTED_SURFACES: readonly ProtectedSurface[] = [
  ...PROTECTED_TREES.map((path) => ({ path, tree: true })),
  ...PROTECTED_LEAVES.map((path) => ({ path, tree: false })),
];

export function robotsDisallowRules(): string[] {
  return PROTECTED_SURFACES.flatMap((surface) =>
    surface.tree ? [`${surface.path}$`, `${surface.path}/`] : [`${surface.path}$`],
  );
}

export const PUBLIC_SURFACES: readonly PublicSurface[] = [
  ...REGISTERED_URLS.filter((url) => !isProtectedPath(url) && !SEO_SURFACES.includes(url)).map(
    (url): PublicSurface => ({ path: url, indexable: !NOT_ADVERTISED.includes(url) }),
  ),
  ...(REGISTERED_URLS.includes("/") ? [] : [{ path: "/", indexable: false }]),
];

export interface SitemapEntry {
  readonly loc: string;
}

function toLoc(origin: string, value: string): string {
  return new URL(value, `${origin}/`).href;
}

export function sitemapEntries(
  origin: string,
  surfaces: readonly PublicSurface[] = PUBLIC_SURFACES,
): SitemapEntry[] {
  return surfaces
    .filter((surface) => surface.indexable)
    .map((surface) => ({ loc: toLoc(origin, surface.path) }));
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderSitemap(entries: readonly SitemapEntry[]): string {
  const rows = entries.map((entry) =>
    ["  <url>", `    <loc>${escapeXml(entry.loc)}</loc>`, "  </url>"].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    "</urlset>",
    "",
  ].join("\n");
}

export function renderRobots(origin: string): string {
  return [
    "# Landing / is noindex via page-level <meta> until the rebuild gate lifts (0509#3989 build step 3).",
    "User-agent: *",
    "Allow: /",
    ...robotsDisallowRules().map((rule) => `Disallow: ${rule}`),
    "",
    `Sitemap: ${toLoc(origin, "/sitemap.xml")}`,
    "",
  ].join("\n");
}
