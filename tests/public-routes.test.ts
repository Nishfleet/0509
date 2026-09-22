import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import routes from "../app/routes";
import {
  PROTECTED_SURFACES,
  PUBLIC_SURFACES,
  isProtectedPath,
  renderRobots,
  renderSitemap,
  routePathToUrl,
  robotsDisallowRules,
  sitemapEntries,
  SITE_ORIGIN,
  type PublicSurface,
} from "../app/lib/public-routes";
import * as robotsRoute from "../app/routes/robots[.]txt";
import * as sitemapRoute from "../app/routes/sitemap[.]xml";

const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
);

function locs(body: string): string[] {
  return [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

function disallowRulesIn(body: string): string[] {
  return [...body.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((match) => match[1]);
}

async function publicDirFiles(): Promise<string[]> {
  const entries = await readdir(PUBLIC_DIR, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) files.push(`/${entry.name}`);
  }
  return files;
}

interface RegisteredRoute {
  readonly file: string;
  readonly url: string;
}

function registeredRoutes(entries: typeof routes, parentUrl = ""): RegisteredRoute[] {
  const found: RegisteredRoute[] = [];
  for (const entry of entries) {
    const url = parentUrl + routePathToUrl(entry.path ?? "");
    if (entry.file) found.push({ file: entry.file.replace(/^routes\//, ""), url });
    if (entry.children) found.push(...registeredRoutes(entry.children, url));
  }
  return found;
}

async function sessionGatedRouteFiles(): Promise<string[]> {
  const routesDir = path.resolve(path.dirname(PUBLIC_DIR), "app", "routes");
  const entries = await readdir(routesDir, { withFileTypes: true });
  const gated: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = await readFile(path.join(routesDir, entry.name), "utf8");
    if (source.includes("requireSession")) gated.push(entry.name);
  }
  return gated;
}

describe("route classification against app/routes.ts (0509#3989)", () => {
  const registered = registeredRoutes(routes);
  const manifestPaths = new Set(PUBLIC_SURFACES.map((surface) => surface.path));

  it("classifies every registered route as protected, seo, or manifest-listed", () => {
    for (const { file, url } of registered) {
      if (isProtectedPath(url)) continue;
      const isSeoSurface = url === "/robots.txt" || url === "/sitemap.xml";
      expect(
        manifestPaths.has(url) || isSeoSurface,
        `public route ${url} (${file}) has no manifest row in app/lib/public-routes.ts`,
      ).toBe(true);
    }
  });

  it("serves every indexable public route in app/routes.ts from the sitemap", async () => {
    const served = new Set(locs(await (await sitemapRoute.loader()).text()));
    for (const { file, url } of registered) {
      if (isProtectedPath(url) || url === "/robots.txt" || url === "/sitemap.xml") {
        continue;
      }
      const row = PUBLIC_SURFACES.find((surface) => surface.path === url);
      expect(row, `public route ${url} (${file}) has no manifest row`).toBeDefined();
      if (!row?.indexable) continue;
      const loc = new URL(row.path, `${SITE_ORIGIN}/`).href;
      expect(
        served.has(loc),
        `indexable public route ${url} (${file}) is missing from the served sitemap`,
      ).toBe(true);
    }
  });

  it("has protected routes to classify, or the rule is untested", () => {
    expect(registered.some(({ url }) => isProtectedPath(url))).toBe(true);
  });

  it("excludes every protected prefix from sitemap entries", () => {
    for (const surface of PUBLIC_SURFACES) {
      expect(isProtectedPath(surface.path), surface.path).toBe(false);
    }
    expect(
      sitemapEntries().some((entry) => isProtectedPath(new URL(entry.loc).pathname)),
    ).toBe(false);
  });
});

describe("isProtectedPath matches the protected surface shape (0509#3989)", () => {
  it("protects every registered protected surface itself", () => {
    for (const surface of PROTECTED_SURFACES) {
      expect(isProtectedPath(surface.path), surface.path).toBe(true);
    }
  });

  it("protects the children of a tree surface", () => {
    for (const surface of PROTECTED_SURFACES) {
      if (!surface.tree) continue;
      expect(isProtectedPath(`${surface.path}/child`), surface.path).toBe(true);
      expect(isProtectedPath(`${surface.path}/deeper/page`), surface.path).toBe(true);
    }
  });

  it("does not protect a sibling that merely shares a leading substring", () => {
    for (const surface of PROTECTED_SURFACES) {
      const sibling = `${surface.path}sibling`;
      expect(isProtectedPath(sibling), sibling).toBe(false);
    }
    expect(isProtectedPath("/apple-touch-icon.png")).toBe(false);
    expect(isProtectedPath("/approach")).toBe(false);
  });

  it("normalizes trailing slashes and ignores the root", () => {
    expect(isProtectedPath("/app/")).toBe(true);
    expect(isProtectedPath("//app//")).toBe(true);
    expect(isProtectedPath("/")).toBe(false);
  });
});

describe("robots Disallow rules match what isProtectedPath protects (0509#3989)", () => {
  const rules = disallowRulesIn(renderRobots());
  const registered = registeredRoutes(routes);

  it("renders one rule per entry of the exported rule list, in order", () => {
    expect(robotsDisallowRules().length).toBeGreaterThan(0);
    expect(rules).toEqual(robotsDisallowRules());
    expect(new Set(rules).size).toBe(rules.length);
  });

  it("disallows the packet's three protected trees and the signed-in onboarding route", () => {
    for (const expected of ["/app", "/api", "/mcp", "/onboarding"]) {
      expect(rules, `${expected} must be disallowed`).toContain(expected);
      expect(isProtectedPath(expected), `${expected} must be protected`).toBe(true);
    }
  });

  it("every rendered rule is a protected path", () => {
    for (const rule of rules) {
      expect(isProtectedPath(rule), `${rule} must be protected`).toBe(true);
    }
  });

  it("blocks no registered public route", () => {
    const blocked = registered.filter(({ url }) => rules.some((rule) => url.startsWith(rule)));
    expect(blocked.map(({ url }) => url)).toEqual(
      registered.filter(({ url }) => isProtectedPath(url)).map(({ url }) => url),
    );
  });

  it("keeps the robots rule and the classifier from drifting on real paths", () => {
    for (const { file, url } of registered) {
      if (isProtectedPath(url)) continue;
      const isSeoSurface = url === "/robots.txt" || url === "/sitemap.xml";
      if (isSeoSurface) continue;
      expect(rules.some((rule) => url.startsWith(rule)), `${url} (${file}) must not be blocked`).toBe(
        false,
      );
    }
  });
});

describe("sitemap.xml (0509#3989)", () => {
  it("serves every indexable manifest row and nothing else", async () => {
    const response = await sitemapRoute.loader();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(locs(body)).toEqual(sitemapEntries().map((entry) => entry.loc));
  });

  it("is schema-shaped: absolute locs, namespaced urlset, valid element order", async () => {
    const body = await (await sitemapRoute.loader()).text();

    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(body.trimEnd().endsWith("</urlset>")).toBe(true);

    const found = locs(body);
    expect(found.length).toBeGreaterThan(0);

    for (const loc of found) {
      expect(() => new URL(loc)).not.toThrow();
      expect(loc).toMatch(/^https:\/\/[^#\s<>"{}|\\^`]+$/);
      expect(loc.includes("#")).toBe(false);
    }

    const allowed = new Set(["loc", "changefreq", "priority"]);
    const order = ["loc", "changefreq", "priority"];
    for (const [, inner] of body.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const tags = [...inner.matchAll(/<(\w+)>/g)].map((match) => match[1]);
      expect(tags[0], "a <url> must open with <loc>, per the 0.9 sequence").toBe("loc");
      for (const tag of tags) {
        expect(allowed.has(tag), `<${tag}> is not a 0.9 <url> child`).toBe(true);
      }
      expect(tags, "0.9 fixes <url> child order").toEqual([...tags].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
      expect(new Set(tags).size, "no repeated child in one <url>").toBe(tags.length);
    }
  });

  it("emits no duplicate <loc>", async () => {
    const found = locs(await (await sitemapRoute.loader()).text());
    expect(new Set(found).size).toBe(found.length);
  });

  it("keeps the origin slash on a root loc", () => {
    const rootEntries = sitemapEntries([
      { path: "/", kind: "static", indexable: true },
    ]);
    expect(rootEntries.map((entry) => entry.loc)).toEqual([`${SITE_ORIGIN}/`]);
  });

  it("escapes XML metacharacters in a loc", () => {
    const body = renderSitemap([{ loc: "https://0509.io/s/a&b<c>d" }]);
    expect(body).toContain("https://0509.io/s/a&amp;b&lt;c&gt;d");
    expect(body).not.toContain("<c>");
  });

  it("flips with the manifest when the landing gate lifts", () => {
    const today = sitemapEntries().map((entry) => entry.loc);
    expect(today).not.toContain(`${SITE_ORIGIN}/`);

    const lifted: PublicSurface[] = PUBLIC_SURFACES.map((surface) =>
      surface.path === "/" ? { ...surface, indexable: true } : surface,
    );
    const liftedLocs = sitemapEntries(lifted).map((entry) => entry.loc);
    expect(liftedLocs).toContain(`${SITE_ORIGIN}/`);
    expect(liftedLocs.length).toBe(today.length + 1);
  });

  it("carries a dynamic loc straight into the document", () => {
    const body = renderSitemap(sitemapEntries(PUBLIC_SURFACES, ["https://0509.io/s/abc"]));
    expect(locs(body)).toContain("https://0509.io/s/abc");
  });
});

describe("robots.txt (0509#3989)", () => {
  it("allows the public root, disallows the protected prefixes, points at the sitemap", async () => {
    const response = await robotsRoute.loader();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    for (const prefix of PROTECTED_SURFACES) {
      expect(body).toContain(`Disallow: ${prefix.path}`);
    }
    expect(body).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });

  it("states the landing is noindex while the gate holds (build step 3)", () => {
    expect(renderRobots()).toContain("noindex");
  });

  it("does not disallow the whole site", () => {
    expect(renderRobots()).not.toMatch(/^Disallow: \/\/?$/m);
  });
});

describe("manifest, routes.ts and public/ agree (0509#3989)", () => {
  it("every static surface in the manifest is a real file under public/", async () => {
    const files = await publicDirFiles();
    for (const surface of PUBLIC_SURFACES) {
      if (surface.kind !== "static") continue;
      const expected = surface.path === "/" ? "/index.html" : surface.path;
      expect(files, `${expected} must exist under public/`).toContain(expected);
    }
  });

  it("every manifest route surface is registered in app/routes.ts", () => {
    const registered = new Set(registeredRoutes(routes).map(({ url }) => url));
    for (const surface of PUBLIC_SURFACES) {
      if (surface.kind !== "route") continue;
      expect(
        registered,
        `${surface.path} must be registered in app/routes.ts`,
      ).toContain(surface.path);
    }
  });

  it("lists no dynamic surface until slugs can be enumerated from data", () => {
    const dynamicRows = PUBLIC_SURFACES.filter((surface) => surface.kind === "dynamic");
    const served = new Set(sitemapEntries().map((entry) => entry.loc));
    for (const row of dynamicRows) {
      expect(row.indexable, `${row.path} must not be advertised without a slug source`).toBe(
        false,
      );
      expect(served.has(`${SITE_ORIGIN}${row.path}`)).toBe(false);
    }
  });

  it("protects every route that requireSession gates, wherever its URL lives", async () => {
    const gated = await sessionGatedRouteFiles();
    expect(gated.length).toBeGreaterThan(0);

    const urlByFile = new Map(
      registeredRoutes(routes).map(({ file, url }) => [file, url]),
    );

    for (const file of gated) {
      const url = urlByFile.get(file);
      expect(
        typeof url === "string",
        `${file} gates a session but is not registered in app/routes.ts`,
      ).toBe(true);
      if (url === undefined) continue;
      expect(isProtectedPath(url), `${url} (${file}) must be protected`).toBe(true);
    }
  });

  it("does not block a file under public/ by prefix under robots matching", async () => {
    const rules = disallowRulesIn(renderRobots());
    const files = await publicDirFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(
        rules.some((rule) => file.startsWith(rule.replace(/\/$/, ""))),
        `${file} under public/ is blocked by a robots Disallow prefix; robots prefix-matches and the classifier is segment-bound`,
      ).toBe(false);
    }
  });
});
