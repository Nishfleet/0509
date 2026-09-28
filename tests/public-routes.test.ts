import type { RouteConfigEntry } from "@react-router/dev/routes";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import routes from "../app/routes";
import {
  DISALLOWED_PREFIXES,
  MCP_URL,
  PUBLIC_PATHS,
  SITEMAP_PATHS,
  llmsTxt,
  robotsTxt,
  sitemapXml,
} from "../app/lib/public-routes";

function topLevel(entries: RouteConfigEntry[]): RouteConfigEntry[] {
  return entries.flatMap((entry) =>
    entry.path === undefined && entry.children ? topLevel(entry.children) : [entry],
  );
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const isDisallowed = (urlPath: string) =>
  DISALLOWED_PREFIXES.some(
    (prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`),
  );

// A robots directive is a robots <meta> tag in a document, and a string
// literal in a module: a JSX attribute value, a template literal, or a plain
// literal. Reading only string literals in a module is what keeps a
// "robots" spelled as an identifier or a type out; reading the literals
// whole is what keeps `content={cond ? "noindex" : "index, follow"}` in.
const withoutComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
const documentsDeclaringNoindex = (document: string) =>
  (withoutComments(document).match(/<meta\b[^>]*>/gi) ?? [])
    .filter((tag) => /\bname\s*=\s*["']robots["']/i.test(tag))
    .some((tag) => /\bnoindex\b/i.test(tag));
const modulesDeclaringNoindex = (module: string) =>
  (
    withoutComments(module).match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g) ??
    []
  ).some((literal) => /\bnoindex\b/i.test(literal));
// The modules that decide what a matched path renders: the route's own
// module, and app/root.tsx, the document React Router wraps every route in.
// Both clear the check together, so a robots tag the root hands down counts.
const servingSources = (route: RouteConfigEntry) =>
  [
    join(REPO_ROOT, "app", route.file),
    join(REPO_ROOT, "app", "root.tsx"),
  ].map((absolute) => ({
    absolute,
    noindex: modulesDeclaringNoindex(readFileSync(absolute, "utf8")),
  }));

describe("public-route manifest", () => {
  it("classifies every top-level route in app/routes.ts", () => {
    for (const entry of topLevel(routes)) {
      const path = "path" in entry ? entry.path : undefined;
      if (
        path === undefined ||
        path === "*" ||
        path === "robots.txt" ||
        path === "sitemap.xml" ||
        path === "llms.txt"
      ) {
        continue;
      }
      const urlPath = `/${path}`;
      const classified =
        (PUBLIC_PATHS as readonly string[]).includes(urlPath) ||
        isDisallowed(urlPath);
      expect(
        classified,
        `route "${path}" is not classified in app/lib/public-routes.ts`,
      ).toBe(true);
    }
  });

  it("robots.txt disallows the manifest prefixes and names the sitemap", () => {
    const body = robotsTxt("https://0509.io");
    expect(body).toContain("Disallow: /app");
    expect(body).toContain("Disallow: /api");
    expect(body).toContain("Disallow: /mcp");
    expect(body).toContain("Sitemap: https://0509.io/sitemap.xml");
  });

  it("sitemap.xml lists every sitemap path as an absolute url in a sitemaps.org urlset", () => {
    const body = sitemapXml("https://0509.io", SITEMAP_PATHS);
    expect(body).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    expect(SITEMAP_PATHS as readonly string[]).toContain("/llms.txt");
    for (const p of SITEMAP_PATHS) {
      expect(body).toContain(`<loc>https://0509.io${p}</loc>`);
    }
    for (const entry of topLevel(routes)) {
      const path = "path" in entry ? entry.path : undefined;
      if (path === undefined || path === "*") continue;
      if (!(SITEMAP_PATHS as readonly string[]).includes(`/${path}`)) continue;
      expect(body).toContain(`<loc>https://0509.io/${path}</loc>`);
    }
  });

  it("keeps every SITEMAP_PATHS member a public route, not just a route", () => {
    for (const path of SITEMAP_PATHS) {
      expect(
        (PUBLIC_PATHS as readonly string[]).includes(path) ||
          path === "/llms.txt",
        `sitemap path "${path}" is public neither to /llms.txt's ## Pages nor as the agent manifest`,
      ).toBe(true);
    }
  });

  it("keeps every SITEMAP_PATHS member a declared, robots-allowed, non-noindex route", () => {
    const routesByUrl = new Map<string, RouteConfigEntry>();
    for (const entry of topLevel(routes)) {
      if (entry.index === true) {
        routesByUrl.set("/", entry);
      } else if (entry.path !== undefined && entry.path !== "*") {
        routesByUrl.set(`/${entry.path}`, entry);
      }
    }
    for (const path of SITEMAP_PATHS) {
      expect(
        isDisallowed(path),
        `sitemap path "${path}" is disallowed by robots.txt`,
      ).toBe(false);
      if (path === "/" && existsSync(join(REPO_ROOT, "public/index.html"))) {
        // "/" is the static rebuild notice until the landing ships an index
        // route; the document that serves it is the one read for noindex.
        expect(
          documentsDeclaringNoindex(
            readFileSync(join(REPO_ROOT, "public/index.html"), "utf8"),
          ),
          "the document serving / declares a robots noindex",
        ).toBe(false);
        continue;
      }
      const route = routesByUrl.get(path);
      expect(
        route,
        `sitemap path "${path}" is not a route in app/routes.ts`,
      ).toBeDefined();
      if (route === undefined) {
        throw new Error(`app/routes.ts declares no route for "${path}"`);
      }
      expect(
        servingSources(route),
        `a module serving "${path}" declares a robots noindex`,
      ).toEqual([
        expect.objectContaining({ noindex: false }),
        expect.objectContaining({ noindex: false }),
      ]);
    }
  });

  it("sitemap.xml escapes xml-special characters in loc values", () => {
    expect(sitemapXml("https://x", ["/a&b"])).toContain("/a&amp;b");
  });

  it("keeps a noindex page out of the sitemap", () => {
    const file = join(REPO_ROOT, "public/index.html");
    const staticHome = existsSync(file) ? readFileSync(file, "utf8") : "";
    const noindex = documentsDeclaringNoindex(staticHome);
    expect((SITEMAP_PATHS as readonly string[]).includes("/")).toBe(!noindex);
  });

  it("llms.txt has the spec's title and summary and links every public path", () => {
    const body = llmsTxt("https://0509.io");
    expect(body.startsWith("# Five to Nine\n\n> ")).toBe(true);
    expect(body).toContain("## Pages");
    expect(body).toContain(MCP_URL);
    for (const p of PUBLIC_PATHS) {
      expect(body).toMatch(new RegExp(`^- \\[[^\\]]+\\]\\(https://0509\\.io${p}\\): \\S`, "m"));
    }
  });
});
