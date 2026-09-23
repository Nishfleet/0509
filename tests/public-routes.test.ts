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
  sitemapEntries,
} from "../app/lib/public-routes";
import * as robotsRoute from "../app/routes/robots[.]txt";
import * as sitemapRoute from "../app/routes/sitemap[.]xml";

const SITE_ORIGIN = "https://0509.io";
const SEO_SURFACES = ["/robots.txt", "/sitemap.xml"];
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const APP_ROUTES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "app",
  "routes",
);

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

function robotsMatchesRule(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  if (anchored) return path === rule.slice(0, -1);
  return path === rule || path.startsWith(rule);
}

function isBlockedByRobots(value: string): boolean {
  return disallowRulesIn(renderRobots(SITE_ORIGIN)).some((rule) => robotsMatchesRule(rule, value));
}

describe("the manifest is derived from app/routes.ts (0509#3989)", () => {
  it("lists every registered route that is not protected and not an seo surface", () => {
    const derived = PUBLIC_SURFACES.map((surface) => surface.path);
    for (const { url } of registeredRoutes(routes)) {
      if (isProtectedPath(url) || SEO_SURFACES.includes(url)) continue;
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
      expect(
        PUBLIC_SURFACES.some((surface) => surface.path === url) || SEO_SURFACES.includes(url),
        `public route ${url} (${file}) is neither protected nor listed`,
      ).toBe(true);
    }
  });

  it("serves every indexable public route in app/routes.ts from the sitemap", async () => {
    const served = new Set(locs(await (await sitemapRoute.loader()).text()));
    const rows = new Map(PUBLIC_SURFACES.map((surface) => [surface.path, surface]));
    for (const { file, url } of registered) {
      if (isProtectedPath(url) || SEO_SURFACES.includes(url)) continue;
      const row = rows.get(url);
      expect(row, `public route ${url} (${file}) is missing from the manifest`).toBeDefined();
      if (!row?.indexable) continue;
      expect(
        served.has(new URL(url, `${SITE_ORIGIN}/`).href),
        `indexable public route ${url} (${file}) is not in the sitemap`,
      ).toBe(true);
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

  it("has protected routes to classify, or the rules are untested", () => {
    expect(registered.some(({ url }) => isProtectedPath(url))).toBe(true);
  });
});

describe("the signed-in set is anchored to the requireSession guard (0509#3989)", () => {
  it("protects every registered route whose module calls requireSession", async () => {
    const guarded: string[] = [];
    for (const { file, url } of registeredRoutes(routes)) {
      if (SEO_SURFACES.includes(url)) continue;
      const source = await readFile(path.join(APP_ROUTES_DIR, file), "utf8");
      if (!/\brequireSession\s*\(/.test(source)) continue;
      guarded.push(url);
      expect(
        isProtectedPath(url),
        `${url} (${file}) calls requireSession but is not protected`,
      ).toBe(true);
    }
    expect(guarded.length).toBeGreaterThan(0);
  });

  it("serves no protected URL in the sitemap", async () => {
    const served = locs(await (await sitemapRoute.loader()).text());
    expect(served.length).toBeGreaterThan(0);
    for (const loc of served) {
      expect(isProtectedPath(new URL(loc).pathname), `${loc} is protected`).toBe(false);
    }
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
      .filter(({ url }) => !isProtectedPath(url) && !SEO_SURFACES.includes(url))
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
  it("serves exactly the advertised public routes", async () => {
    const response = await sitemapRoute.loader();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(locs(body)).toEqual([`${SITE_ORIGIN}/login`, `${SITE_ORIGIN}/privacy`]);
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

    for (const [, inner] of body.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const tags = [...inner.matchAll(/<(\w+)>/g)].map((match) => match[1]);
      expect(tags, "a 0.9 <url> carries only <loc>").toEqual(["loc"]);
    }
  });

  it("emits no duplicate <loc>", async () => {
    const found = locs(await (await sitemapRoute.loader()).text());
    expect(new Set(found).size).toBe(found.length);
  });

  it("keeps the origin slash on a root loc", () => {
    const rootEntries = sitemapEntries(SITE_ORIGIN, [{ path: "/", indexable: true }]);
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

    const lifted = PUBLIC_SURFACES.map((surface) =>
      surface.path === "/" ? { ...surface, indexable: true } : surface,
    );
    expect(sitemapEntries(SITE_ORIGIN, lifted).map((entry) => entry.loc)).toContain(
      `${SITE_ORIGIN}/`,
    );
  });
});

describe("robots.txt (0509#3989)", () => {
  it("allows the public root, disallows the protected surfaces, points at the sitemap", async () => {
    const response = await robotsRoute.loader();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body.split("\n")).toContain("User-agent: *");
    expect(body.split("\n")).toContain("Allow: /");
    expect(body.split("\n")).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
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
  it("accounts for the static landing row without advertising it", async () => {
    const root = PUBLIC_SURFACES.find((surface) => surface.path === "/");
    expect(root, "the landing must be classified").toBeDefined();
    expect(root?.indexable).toBe(false);

    const files = await publicDirFiles();
    expect(files).toContain("/index.html");
  });

  it("advertises no surface with a route pattern, since no slugs can be enumerated", () => {
    const advertised = PUBLIC_SURFACES.filter((surface) => surface.indexable).map(
      (surface) => surface.path,
    );
    for (const path of advertised) {
      expect(path, `${path} is a route pattern, not a URL`).not.toMatch(/[:*]/);
    }
  });

  it("advertises only a path a registered route or a public/ file serves", async () => {
    const registered = new Set(registeredRoutes(routes).map(({ url }) => url));
    const files = await publicDirFiles();
    for (const surface of PUBLIC_SURFACES) {
      if (!surface.indexable) continue;
      const file = surface.path === "/" ? "/index.html" : surface.path;
      expect(
        registered.has(surface.path) || files.includes(file),
        `${surface.path} is advertised but no route or file serves it`,
      ).toBe(true);
    }
  });
});
