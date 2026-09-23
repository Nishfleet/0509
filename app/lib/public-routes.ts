import type { RouteConfigEntry } from "@react-router/dev/routes";

import routes from "../routes";

type SurfaceKind = "static" | "route";

export interface PublicSurface {
  readonly path: string;
  readonly kind: SurfaceKind;
  readonly indexable: boolean;
  readonly changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  readonly priority?: number;
  readonly note?: string;
}

export interface ProtectedSurface {
  readonly path: string;
  readonly tree: boolean;
}

const PROTECTED_TREES: readonly string[] = ["/app", "/api", "/mcp"];

const PROTECTED_LEAVES: readonly string[] = ["/onboarding"];

const NON_INDEXABLE: readonly string[] = [
  "/",
  "/*",
  "/s/:slug",
  "/design/brand-chips",
  "/robots.txt",
  "/sitemap.xml",
];

const SITE_NOTES: Readonly<Record<string, string>> = {
  "/": "public/index.html; noindex until the landing gate lifts (build step 3)",
  "/login": "public page, listed per build step 1",
  "/s/:slug":
    "a published standing card. Not advertised until slugs can be enumerated from data (0509#3898); sitemapEntries(origin, surfaces, dynamicLocs) is the seam.",
  "/design/brand-chips": "a design-directions page, not a public surface of the product.",
  "/*": "the 404 catch-all. A page a crawler is sent to on a bad URL is not a page to index.",
  "/robots.txt": "the crawler policy itself.",
  "/sitemap.xml": "the index itself.",
};

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
  return PROTECTED_TREES.some(
    (tree) => normalized === tree || normalized.startsWith(`${tree}/`),
  );
}

interface RegisteredRoute {
  readonly file: string;
  readonly url: string;
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

function registeredUrls(): string[] {
  return registeredRoutes(routes as readonly RouteConfigEntry[]).map(({ url }) => url);
}

function hasRegisteredUrl(url: string): boolean {
  return registeredUrls().includes(url);
}

export const PUBLIC_SURFACES: readonly PublicSurface[] = registeredUrls()
  .filter((url) => !isProtectedPath(url) && !SEO_SURFACES.includes(url))
  .map((url) => ({
    path: url,
    kind: "route" as const,
    indexable: !NON_INDEXABLE.includes(url),
    note: SITE_NOTES[url],
  }))
  .concat(
    hasRegisteredUrl("/")
      ? []
      : [{ path: "/", kind: "static" as const, indexable: false, note: SITE_NOTES["/"] }],
  );

export const PROTECTED_SURFACES: readonly ProtectedSurface[] = [
  ...PROTECTED_TREES.map((path) => ({ path, tree: true })),
  ...PROTECTED_LEAVES.map((path) => ({ path, tree: false })),
].filter(
  (surface, index, all) => all.findIndex((other) => other.path === surface.path) === index,
);

export function robotsDisallowRules(): string[] {
  return PROTECTED_SURFACES.flatMap((surface) =>
    surface.tree ? [`${surface.path}/`] : [surface.path],
  );
}

export interface SitemapEntry {
  readonly loc: string;
  readonly changeFrequency?: PublicSurface["changeFrequency"];
  readonly priority?: number;
}

function toLoc(origin: string, value: string): string {
  return new URL(value, `${origin}/`).href;
}

export function sitemapEntries(
  origin: string,
  surfaces: readonly PublicSurface[] = PUBLIC_SURFACES,
  dynamicLocs: readonly string[] = [],
): SitemapEntry[] {
  return surfaces
    .filter((surface) => surface.indexable)
    .map((surface) => ({
      loc: toLoc(origin, surface.path),
      changeFrequency: surface.changeFrequency,
      priority: surface.priority,
    }))
    .concat(dynamicLocs.map((loc) => ({ loc })));
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>]/g, (character) => XML_ESCAPES[character] ?? character);
}

export function renderSitemap(entries: readonly SitemapEntry[]): string {
  const rows = entries.map((entry) =>
    [
      "  <url>",
      `    <loc>${escapeXml(entry.loc)}</loc>`,
      ...(entry.changeFrequency
        ? [`    <changefreq>${entry.changeFrequency}</changefreq>`]
        : []),
      ...(entry.priority !== undefined
        ? [`    <priority>${entry.priority.toFixed(1)}</priority>`]
        : []),
      "  </url>",
    ].join("\n"),
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
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}
