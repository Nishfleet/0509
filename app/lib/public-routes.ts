type SurfaceKind = "static" | "route" | "dynamic";

export interface PublicSurface {
  readonly path: string;
  readonly kind: SurfaceKind;
  readonly indexable: boolean;
  readonly changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  readonly priority?: number;
  readonly note?: string;
}

export const PUBLIC_SURFACES: readonly PublicSurface[] = [
  {
    path: "/",
    kind: "static",
    indexable: false,
    changeFrequency: "weekly",
    priority: 1,
    note: "public/index.html; noindex until the landing gate lifts (build step 3)",
  },
  {
    path: "/login",
    kind: "route",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.5,
    note: "app/routes/login.tsx; public page, listed per build step 1",
  },
];

export interface ProtectedSurface {
  readonly path: string;
  readonly tree: boolean;
  readonly note?: string;
}

export const PROTECTED_SURFACES: readonly ProtectedSurface[] = [
  { path: "/app", tree: true, note: "signed-in app, behind requireSession" },
  { path: "/onboarding", tree: false, note: "signed-in first-run, behind requireSession" },
  { path: "/api", tree: true, note: "REST surface (docs/engines/api-mcp.md)" },
  { path: "/mcp", tree: true, note: "agent surface (docs/engines/api-mcp.md)" },
];

export const SITE_ORIGIN = "https://0509.io";

function normalizePath(path: string): string {
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : `/${trimmed}`;
}

export function isProtectedPath(path: string): boolean {
  const normalized = normalizePath(path);
  return PROTECTED_SURFACES.some((surface) => {
    if (normalized === surface.path) return true;
    return surface.tree && normalized.startsWith(`${surface.path}/`);
  });
}

export function robotsDisallowRules(): string[] {
  return PROTECTED_SURFACES.flatMap((surface) => [surface.path, `${surface.path}/`]);
}

export function routePathToUrl(routePath: string): string {
  return `/${routePath.replace(/^\//, "").replace(/\/\*$/, "")}`;
}

export interface SitemapEntry {
  readonly loc: string;
  readonly changeFrequency?: PublicSurface["changeFrequency"];
  readonly priority?: number;
}

function toLoc(path: string): string {
  return new URL(path, `${SITE_ORIGIN}/`).href;
}

export function sitemapEntries(
  surfaces: readonly PublicSurface[] = PUBLIC_SURFACES,
  dynamicLocs: readonly string[] = [],
): SitemapEntry[] {
  const rows: SitemapEntry[] = surfaces
    .filter((surface) => surface.indexable)
    .map((surface) => ({
      loc: toLoc(surface.path),
      changeFrequency: surface.changeFrequency,
      priority: surface.priority,
    }));

  for (const loc of dynamicLocs) {
    rows.push({ loc });
  }

  return rows;
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

export function renderRobots(): string {
  return [
    "# Landing / is noindex via page-level <meta> until the rebuild gate lifts (0509#3989 build step 3).",
    "User-agent: *",
    "Allow: /",
    ...robotsDisallowRules().map((rule) => `Disallow: ${rule}`),
    "",
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>]/g, (character) => XML_ESCAPES[character] ?? character);
}
