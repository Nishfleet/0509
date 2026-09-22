import { readFile, readdir, stat } from "node:fs/promises";
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

function robotsDisallowRules(body: string): string[] {
  return [...body.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((match) => match[1]);
}

async function publicDirFiles(): Promise<string[]> {
  const entries = await readdir(PUBLIC_DIR, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(PUBLIC_DIR, entry.name);
    if ((await stat(full)).isFile()) files.push(`/${entry.name}`);
  }
  return files;
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
  const registered = routes.map((route) => routePathToUrl(route.path ?? ""));
  const manifestPaths = new Set(PUBLIC_SURFACES.map((surface) => surface.path));

  it("classifies every registered route as protected, seo, or manifest-listed", () => {
    for (const url of registered) {
      if (isProtectedPath(url)) continue;
      const isSeoSurface = url === "/robots.txt" || url === "/sitemap.xml";
      expect(
        manifestPaths.has(url) || isSeoSurface,
        `public route ${url} has no manifest row in app/lib/public-routes.ts`,
      ).toBe(true);
    }
  });

  it("has protected routes to classify, or the rule is untested", () => {
    expect(registered.some((url) => isProtectedPath(url))).toBe(true);
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
  const rules = robotsDisallowRules(renderRobots());

  it("disallows exactly the registered protected surfaces", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(isProtectedPath(rule), `${rule} must be protected`).toBe(true);
    }
    for (const surface of PROTECTED_SURFACES) {
      expect(rules, `${surface.path} must have a rule`).toContain(surface.path);
    }
    expect(new Set(rules).size).toBe(rules.length);
  });

  it("blocks no registered public route", () => {
    const registered = routes.map((route) => routePathToUrl(route.path ?? ""));
    const blocked = registered.filter((url) => rules.some((rule) => url.startsWith(rule)));
    expect(blocked).toEqual(registered.filter((url) => isProtectedPath(url)));
  });

  it("keeps the robots rule and the manifest classifier from drifting on real paths", () => {
    const registered = routes.map((route) => routePathToUrl(route.path ?? ""));
    for (const url of registered) {
      if (isProtectedPath(url)) continue;
      const isSeoSurface = url === "/robots.txt" || url === "/sitemap.xml";
      if (isSeoSurface) continue;
      expect(rules.some((rule) => url.startsWith(rule)), `${url} must not be blocked`).toBe(
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
    const registered = new Set(routes.map((route) => routePathToUrl(route.path ?? "")));
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

    const registered = new Set(routes.map((route) => routePathToUrl(route.path ?? "")));
    const moduleFileFor = (url: string): string => {
      const base = url === "/" ? "home" : url.replace(/^\//, "").replace(/\//g, ".");
      return `${base}.`;
    };

    const gatedByFile = new Map<string, string>();
    for (const url of registered) {
      for (const file of gated.filter((candidate) => candidate.startsWith(moduleFileFor(url)))) {
        gatedByFile.set(file, url);
      }
    }

    for (const file of gated) {
      const url = gatedByFile.get(file);
      expect(url, `${file} gates a session but matches no registered route`).toBeTruthy();
      if (url === undefined) continue;
      expect(isProtectedPath(url), `${url} (${file}) must be protected`).toBe(true);
    }
  });
});
