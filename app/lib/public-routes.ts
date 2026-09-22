/**
 * The public-surface route manifest (0509#3989).
 *
 * One source of truth for two derived artifacts, `/sitemap.xml` and
 * `/robots.txt` (`docs/engines/api-mcp.md` §4: "generated from the same route
 * manifest the sitemap uses"). Both routes import this module; neither
 * hand-maintains a path list, so a surface cannot appear in one and be missing
 * from the other.
 *
 * This module answers "which public URLs does a search engine get told about".
 * It is not the route registry — `app/routes.ts` is — and it is not a page
 * registry. `tests/public-routes.test.ts` holds the correspondence between the
 * three by asserting, against `app/routes.ts` and `public/`, that:
 *
 *   - every route `app/routes.ts` registers as public has a manifest row;
 *   - every route it registers as app/api/mcp is excluded from the sitemap;
 *   - every static surface named here really exists under `public/`.
 *
 * An entry here describes a URL a crawler can fetch today. A planned surface is
 * not listed until the route that serves it exists: a URL in the sitemap that
 * 404s is a lie (`docs/FEATURE-MAP.md`, "a row here that no route serves is a
 * lie").
 */

/**
 * How the URL is served.
 *
 * `static` is a file under `public/`, served from the edge with no Worker
 * invocation; `route` is backed by a module in `app/routes.ts`; `dynamic` is a
 * public route whose URL space is parameterised and enumerated from data.
 */
type SurfaceKind = "static" | "route" | "dynamic";

export interface PublicSurface {
  /** Root-relative path, no trailing slash except the root `/`. */
  readonly path: string;
  readonly kind: SurfaceKind;

  /**
   * Whether this path belongs in `/sitemap.xml`. A public URL can be reachable
   * but deliberately not indexed — the quiet landing carries `robots: noindex`
   * until the gate lifts — and the two are different facts on purpose.
   */
  readonly indexable: boolean;
  readonly changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  readonly priority?: number;
  /** Why the path is, or is not, indexable. Read by reviewers, not crawlers. */
  readonly note?: string;
}

/**
 * Root first, then public pages in the order a crawler should meet them. `/` is
 * `public/index.html` (0509#3957) and has no row in `app/routes.ts`, which is
 * why `kind` exists and why a pure `routes.ts` derivation cannot describe the
 * landing.
 */
export const PUBLIC_SURFACES: readonly PublicSurface[] = [
  {
    path: "/",
    kind: "static",
    // The landing is `public/index.html` and still carries `robots: noindex`
    // while the quiet-rebuild gate holds. Reachable, not advertised: listing a
    // noindex URL in the sitemap is the contradiction the issue names, so the
    // row stays and flipping this one boolean is the whole change when the gate
    // lifts (build step 3).
    indexable: false,
    changeFrequency: "weekly",
    priority: 1,
    note: "public/index.html; noindex until the landing gate lifts (build step 3)",
  },
  {
    path: "/login",
    kind: "route",
    // Build step 1 lists /login among the public routes the sitemap carries,
    // and it is the honest consequence of build step 3: `/` stays noindex until
    // the landing gate lifts, so /login is the only public page a crawler can
    // be sent to today. It is a real page with a real URL and no protection —
    // indexing it is correct, and it keeps the document schema-valid (a
    // sitemaps.org `urlset` requires at least one `<url>`; an empty one is
    // rejected, not ignored).
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.5,
    note: "app/routes/login.tsx; public page, listed per build step 1",
  },
];

/**
 * The path prefixes that are not public surfaces, and that robots.txt is told
 * to disallow. `app` is signed-in (behind `requireSession`), `api` is the REST
 * surface and `mcp` is the agent surface (`docs/engines/api-mcp.md`). This is
 * the classifier `app/routes.ts` already obeys by convention; naming it here is
 * what lets the test enforce it instead of restating it.
 */
export const DISALLOWED_PREFIXES: readonly string[] = ["/app", "/api", "/mcp"];

/** The canonical origin. Crawlers need absolute URLs; robots needs one host. */
export const SITE_ORIGIN = "https://0509.io";

/** Whether a URL path is a non-public app, API or MCP surface. */
export function isProtectedPath(path: string): boolean {
  const normalized = `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return DISALLOWED_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/**
 * Normalize a registered route path from `app/routes.ts` into URL space: add
 * the leading slash, drop a splat suffix (`api/auth/*` -> `/api/auth`).
 */
export function routePathToUrl(routePath: string): string {
  return `/${routePath.replace(/^\//, "").replace(/\/\*$/, "")}`;
}

export interface SitemapEntry {
  readonly loc: string;
  readonly changeFrequency?: PublicSurface["changeFrequency"];
  readonly priority?: number;
}

function toLoc(path: string): string {
  return new URL(path, `${SITE_ORIGIN}/`).href.replace(/\/$/, "");
}

/**
 * The sitemap rows for a surface list: every indexable row, plus any caller-
 * supplied dynamic locs (`/s/<slug>` once that engine lands the `is_published`
 * column). The dynamic list is empty today; the parameter is the seam, not a
 * stub.
 */
export function sitemapEntries(
  surfaces: readonly PublicSurface[] = PUBLIC_SURFACES,
  dynamicLocs: readonly string[] = [],
): SitemapEntry[] {
  const rows = surfaces
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

/**
 * Render a sitemap document from an explicit row list. Pure and synchronous, so
 * the route is a thin wrapper and the test can assert the document without a
 * server. The root `<urlset>` namespace is not decoration: a sitemap without it
 * is silently ignored by a crawler rather than rejected, so the failure mode is
 * "nothing is indexed" with no error to find.
 */
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

/**
 * Render the robots policy. Pure and synchronous, so the route is a thin
 * wrapper and the test can assert it without a server.
 *
 * No global `Disallow: /` on purpose: indexing of `/` is controlled by the
 * page's own `robots: noindex` meta (`public/index.html`, until the rebuild
 * gate lifts — build step 3), and a global disallow would block the fetch that
 * reads that meta. A noindex that cannot be read is indistinguishable from one
 * that was obeyed, so the distinction between "not indexed" and "not
 * fetchable" is kept as a page-level meta, and this file stays a fetch policy.
 */
export function renderRobots(): string {
  return [
    "# 0509 robots policy. Derived from app/lib/public-routes.ts (0509#3989) —",
    "# the same manifest as /sitemap.xml, so the two cannot drift.",
    "",
    "User-agent: *",
    "Allow: /",
    ...DISALLOWED_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    "",
    "# The landing `/` carries a page-level noindex until the rebuild gate lifts",
    "# (build step 3); that is a <meta>, not a Disallow, so the page stays",
    "# fetchable and the noindex can be read and obeyed. A global",
    "# `Disallow: /` would make the noindex unobservable.",
    "",
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n");
}

// `&`, `<` and `>` are the schema's reserved characters in a `<loc>`. The
// manifest's paths hold none today, but a future dynamic slug is arbitrary, so
// the serializer escapes rather than trusting the data. One pass over the
// three characters, not three sequential passes, so a replacement is never
// re-escaped by a subsequent step.
const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>]/g, (character) => XML_ESCAPES[character] ?? character);
}
