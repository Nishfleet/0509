import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { BETTER_AUTH_URL: "https://0509.io" } }));

import routes from "../app/routes";
import {
  PUBLIC_SURFACES,
  PROTECTED_SURFACES,
  isProtectedPath,
  renderRobots,
  renderSitemap,
  registeredRoutes,
  robotsDisallowRules,
  sitemapEntries,
  type PublicSurface,
} from "../app/lib/public-routes";
import * as robotsRoute from "../app/routes/robots[.]txt";
import * as sitemapRoute from "../app/routes/sitemap[.]xml";

const SITE_ORIGIN = "https://0509.io";
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

function locs(body: string): string[] {
  return [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

function disallowRulesIn(body: string): string[] {
  return [...body.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((match) => match[1]);
}

async function publicDirFiles(): Promise<string[]> {
  const entries = await readdir(PUBLIC_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => `/${entry.name}`);
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

function robotsMatchesRule(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  if (anchored) return path === rule.slice(0, -1);
  return path === rule || path.startsWith(rule);
}

function isBlockedByRobots(value: string): boolean {
  return robotsDisallowRules().some((rule) => robotsMatchesRule(rule, value));
}

describe("the manifest is derived from app/routes.ts (0509#3989)", () => {
  it("lists every registered route that is not protected and not an seo surface", () => {
    const derived = PUBLIC_SURFACES.map((surface) => surface.path);
    for (const { url } of registeredRoutes(routes)) {
      if (isProtectedPath(url) || url === "/robots.txt" || url === "/sitemap.xml") continue;
      expect(derived, `registered public route ${url} is missing from the manifest`).toContain(url);
    }
    for (const url of derived) {
      expect(
        registeredRoutes(routes).some((route) => route.url === url) || url === "/",
        `${url} has no route in app/routes.ts`,
      ).toBe(true);
    }
  });
});

describe("route classification against app/routes.ts (0509#3989)", () => {
  const registered = registeredRoutes(routes);

  it("classifies every registered route as protected or manifest-listed", () => {
    for (const { file, url } of registered) {
      if (isProtectedPath(url)) continue;
      const isSeoSurface = url === "/robots.txt" || url === "/sitemap.xml";
      expect(
        PUBLIC_SURFACES.some((surface) => surface.path === url) || isSeoSurface,
        `public route ${url} (${file}) is neither protected nor listed`,
      ).toBe(true);
    }
  });

  it("serves every indexable public route in app/routes.ts from the sitemap", async () => {
    const served = new Set(locs(await (await sitemapRoute.loader()).text()));
    for (const { file, url } of registered) {
      if (isProtectedPath(url) || url === "/robots.txt" || url === "/sitemap.xml") continue;
      const row = PUBLIC_SURFACES.find((surface) => surface.path === url);
      expect(row, `public route ${url} (${file}) is missing from the manifest`).toBeDefined();
      if (!row?.indexable) continue;
      const loc = new URL(row.path, `${SITE_ORIGIN}/`).href;
      expect(served.has(loc), `indexable public route ${url} (${file}) is not in the sitemap`).toBe(
        true,
      );
    }
  });

  it("excludes every protected prefix from sitemap entries", () => {
    for (const surface of PUBLIC_SURFACES) {
      expect(isProtectedPath(surface.path), surface.path).toBe(false);
    }
    expect(
      sitemapEntries(SITE_ORIGIN).some((entry) => isProtectedPath(new URL(entry.loc).pathname)),
    ).toBe(false);
  });

  it("protects every route that requireSession gates, wherever its URL lives", async () => {
    const gated = await sessionGatedRouteFiles();
    expect(gated.length).toBeGreaterThan(0);

    const urlByFile = new Map(registered.map(({ file, url }) => [file, url]));
    for (const file of gated) {
      const url = urlByFile.get(file);
      expect(typeof url === "string", `${file} gates a session but is not registered`).toBe(true);
      if (url === undefined) continue;
      expect(isProtectedPath(url), `${url} (${file}) must be protected`).toBe(true);
    }
  });

  it("has protected routes to classify, or the rules are untested", () => {
    expect(registered.some(({ url }) => isProtectedPath(url))).toBe(true);
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
      expect(isProtectedPath(`${surface.path}sibling`), surface.path).toBe(false);
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
  it("renders one rule per protected surface, and each protects its surface", () => {
    const rules = disallowRulesIn(renderRobots(SITE_ORIGIN));
    expect(rules.length).toBeGreaterThan(0);
    for (const surface of PROTECTED_SURFACES) {
      expect(rules).toContain(`${surface.path}$`);
      if (surface.tree) expect(rules).toContain(`${surface.path}/`);
    }
  });

  it("disallows the packet's three protected trees and the signed-in onboarding route", () => {
    for (const surface of PROTECTED_SURFACES) {
      expect(isBlockedByRobots(surface.path), `${surface.path} must be blocked`).toBe(true);
      const child = surface.tree ? `${surface.path}/child` : surface.path;
      expect(isBlockedByRobots(child), `${child} must be blocked`).toBe(true);
    }
  });

  it("blocks no registered public route", () => {
    const blocked = registeredRoutes(routes)
      .filter(({ url }) =>
        isProtectedPath(url) || url === "/robots.txt" || url === "/sitemap.xml" ? false : true,
      )
      .filter(({ url }) => isBlockedByRobots(url));
    expect(blocked).toEqual([]);
  });

  it("does not block a public file under public/ that shares a protected prefix", async () => {
    const files = await publicDirFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(isBlockedByRobots(file), `${file} is blocked by a robots prefix`).toBe(false);
    }
  });

  it("does not block /apple-touch-icon.png, which shares the /app leading substring", () => {
    expect(isBlockedByRobots("/apple-touch-icon.png")).toBe(false);
  });

  it("blocks /app exactly (the registered route) and not /apple-touch-icon.png", () => {
    expect(isBlockedByRobots("/app")).toBe(true);
    expect(isBlockedByRobots("/app/competitors")).toBe(true);
    expect(isBlockedByRobots("/apple-touch-icon.png")).toBe(false);
    expect(isBlockedByRobots("/approach")).toBe(false);
  });
});

describe("sitemap.xml (0509#3989)", () => {
  it("serves every indexable manifest row and nothing else", async () => {
    const response = await sitemapRoute.loader();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(locs(body)).toEqual(sitemapEntries(SITE_ORIGIN).map((entry) => entry.loc));
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
    }

    const allowed = new Set(["loc", "changefreq", "priority"]);
    const order = ["loc", "changefreq", "priority"];
    for (const [, inner] of body.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const tags = [...inner.matchAll(/<(\w+)>/g)].map((match) => match[1]);
      expect(tags[0], "a <url> must open with <loc>").toBe("loc");
      for (const tag of tags) {
        expect(allowed.has(tag), `<${tag}> is not a 0.9 <url> child`).toBe(true);
      }
      expect(tags, "0.9 fixes <url> child order").toEqual(
        [...tags].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
      );
      expect(new Set(tags).size, "no repeated child in one <url>").toBe(tags.length);
    }
  });

  it("emits no duplicate <loc>", async () => {
    const found = locs(await (await sitemapRoute.loader()).text());
    expect(new Set(found).size).toBe(found.length);
  });

  it("keeps the origin slash on a root loc", () => {
    const rootEntries = sitemapEntries(SITE_ORIGIN, [
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
    const today = sitemapEntries(SITE_ORIGIN).map((entry) => entry.loc);
    expect(today).not.toContain(`${SITE_ORIGIN}/`);

    const lifted: PublicSurface[] = PUBLIC_SURFACES.map((surface) =>
      surface.path === "/" ? { ...surface, indexable: true } : surface,
    );
    expect(sitemapEntries(SITE_ORIGIN, lifted).map((entry) => entry.loc)).toContain(
      `${SITE_ORIGIN}/`,
    );
  });

  it("carries a dynamic loc straight into the document", () => {
    expect(
      locs(renderSitemap(sitemapEntries(SITE_ORIGIN, PUBLIC_SURFACES, ["https://0509.io/s/abc"]))),
    ).toContain("https://0509.io/s/abc");
  });
});

describe("robots.txt (0509#3989)", () => {
  it("allows the public root, disallows the protected surfaces, points at the sitemap", async () => {
    const response = await robotsRoute.loader();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    for (const surface of PROTECTED_SURFACES) {
      expect(isBlockedByRobots(surface.path), `${surface.path} must be disallowed`).toBe(true);
    }
  });

  it("states the landing is noindex while the gate holds (build step 3)", () => {
    expect(renderRobots(SITE_ORIGIN)).toContain("noindex");
  });

  it("does not disallow the whole site", () => {
    expect(renderRobots(SITE_ORIGIN)).not.toMatch(/^Disallow: \/\/?$/m);
  });
});

describe("manifest and public/ agree (0509#3989)", () => {
  it("every static surface in the manifest is a real file under public/", async () => {
    const files = await publicDirFiles();
    for (const surface of PUBLIC_SURFACES) {
      if (surface.kind !== "static") continue;
      const expected = surface.path === "/" ? "/index.html" : surface.path;
      expect(files, `${expected} must exist under public/`).toContain(expected);
    }
  });

  it("lists no surface with a dynamic route path, since no slugs can be enumerated", () => {
    expect(PUBLIC_SURFACES.filter((surface) => (surface as { kind: string }).kind === "dynamic")).toEqual([]);
  });

  it("does not advertise a surface whose route does not exist", () => {
    const registered = new Set(registeredRoutes(routes).map(({ url }) => url));
    for (const surface of PUBLIC_SURFACES) {
      if (surface.kind !== "route") continue;
      expect(registered.has(surface.path), `${surface.path} must be registered`).toBe(true);
    }
  });
});