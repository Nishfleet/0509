import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import routes from "../app/routes";
import {
  DISALLOWED_PREFIXES,
  PUBLIC_SURFACES,
  renderRobots,
  renderSitemap,
  routePathToUrl,
  isProtectedPath,
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

// 0509#3989. The acceptance bar is "a test asserting every public route in
// app/routes.ts appears in the sitemap". Read literally against today's tree
// that promise is mostly vacuous: `app/routes.ts` registers exactly one public
// page route (`/login` — the other public URL, `/`, is `public/index.html`,
// not a route; 0509#3957), and it stays noindex until the rebuild gate lifts
// (build step 3).
//
// So this file pins the structure that makes the promise real the moment a
// public route is added, and fails loudly if the structure breaks:
//
//   (1) every route `app/routes.ts` registers is classified — protected
//       prefixes are excluded from the sitemap, everything else must have a
//       manifest row;
//   (2) the served document contains exactly the manifest's indexable set, and
//       flipping a row to `indexable: true` moves it into the document;
//   (3) the document is schema-shaped sitemaps.org XML;
//   (4) robots allows the public root, disallows exactly the protected
//       prefixes, and points at the sitemap;
//   (5) the manifest, `app/routes.ts` and `public/` agree with each other.

/** Every `<loc>` in a sitemap document. */
function locs(body: string): string[] {
  return [...body.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
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

describe("route classification against app/routes.ts (0509#3989)", () => {
  const registered = routes.map((route) => routePathToUrl(route.path ?? ""));
  const manifestPaths = new Set(PUBLIC_SURFACES.map((surface) => surface.path));

  it("classifies every registered route as protected, seo, or manifest-listed", () => {
    for (const url of registered) {
      if (isProtectedPath(url)) continue;
      // robots.txt and sitemap.xml are the derived SEO surfaces this PR adds:
      // public and fetchable, but infrastructure — a sitemap that lists
      // robots.txt is indexing the indexer.
      const isSeoSurface = url === "/robots.txt" || url === "/sitemap.xml";
      expect(
        manifestPaths.has(url) || isSeoSurface,
        `public route ${url} has no manifest row in app/lib/public-routes.ts`,
      ).toBe(true);
    }
  });

  it("has protected routes to classify, or the rule is untested", () => {
    // The protection rule is only meaningful if it fires today; if the app/api
    // routes ever disappear, this is the alarm that it stopped being tested.
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

  it("disallows exactly the protected prefixes", () => {
    expect([...DISALLOWED_PREFIXES]).toEqual(["/app", "/api", "/mcp"]);
    for (const prefix of DISALLOWED_PREFIXES) {
      expect(isProtectedPath(prefix)).toBe(true);
    }
  });
});

describe("sitemap.xml (0509#3989)", () => {
  it("serves every indexable manifest row and nothing else", async () => {
    const response = await sitemapRoute.loader();
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(locs(body)).toEqual(sitemapEntries().map((entry) => entry.loc));
    expect(locs(body)).toEqual(
      PUBLIC_SURFACES.filter((s) => s.indexable).map((s) => `${SITE_ORIGIN}${s.path}`),
    );
  });

  it("is schema-shaped: absolute locs, namespaced urlset, valid element order", async () => {
    const body = await (await sitemapRoute.loader()).text();

    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    // The namespace is the part a crawler silently drops the document without
    // rather than erroring — the failure mode is "nothing indexed".
    expect(body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(body.trimEnd().endsWith("</urlset>")).toBe(true);

    // sitemaps.org schema: `url` is maxOccurs=unbounded with an implicit
    // minOccurs=1, so an empty <urlset> is INVALID, not merely useless. This is
    // why the manifest must always keep one indexable public page — /login
    // today — and why the guard is a test, not a comment.
    const found = locs(body);
    expect(found.length).toBeGreaterThan(0);

    for (const loc of found) {
      expect(() => new URL(loc)).not.toThrow();
      // Schema: loc is an absolute http(s) URL, no fragment.
      expect(loc).toMatch(/^https:\/\/[^#\s<>"{}|\\^`]+$/);
      expect(loc.includes("#")).toBe(false);
    }
  });

  it("emits no duplicate <loc>", async () => {
    const found = locs(await (await sitemapRoute.loader()).text());
    expect(new Set(found).size).toBe(found.length);
  });

  it("escapes XML metacharacters in a loc", () => {
    const body = renderSitemap([{ loc: "https://0509.io/s/a&b<c>d" }]);
    expect(body).toContain("https://0509.io/s/a&amp;b&lt;c&gt;d");
    expect(body).not.toContain("<c>");
  });

  it("flips with the manifest when the landing gate lifts", () => {
    // Build step 3: remove the blanket noindex once the landing ships. The one
    // change that makes it happen is flipping `indexable` on the `/` row, so
    // the document must be derived from that boolean, not hardcoded.
    const today = sitemapEntries().map((entry) => entry.loc);
    expect(today).toEqual([`${SITE_ORIGIN}/login`]);
    expect(today).not.toContain(SITE_ORIGIN); // `/` is noindex today

    const lifted: PublicSurface[] = PUBLIC_SURFACES.map((surface) =>
      surface.path === "/" ? { ...surface, indexable: true } : surface,
    );
    expect(sitemapEntries(lifted).map((entry) => entry.loc)).toEqual([
      SITE_ORIGIN,
      `${SITE_ORIGIN}/login`,
    ]);
  });

  it("carries a dynamic loc straight into the document", () => {
    // The seam build step 1 names: each published /s/<slug>. The engine lands
    // with the is_published column; the document already accepts the list.
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
    for (const prefix of DISALLOWED_PREFIXES) {
      expect(body).toContain(`Disallow: ${prefix}`);
    }
    expect(body).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });

  it("documents the noindex state while the gate holds (build step 3)", () => {
    const body = renderRobots();
    expect(body).toContain("noindex");
    expect(body).toContain("rebuild gate lifts");
  });

  it("does not disallow the whole site", () => {
    // A global `Disallow: /` would block the fetch that reads the landing's
    // page-level noindex meta, making the noindex unobservable.
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

  it("lists no dynamic surface while none can be enumerated", () => {
    // `/s/<slug>` (engine P9.1, #3898) needs the is_published column before a
    // slug list can be read from D1. Listing it before then would publish a URL
    // no route serves — the exact lie docs/FEATURE-MAP.md forbids.
    for (const surface of PUBLIC_SURFACES) {
      expect(surface.kind, `${surface.path} must not be dynamic yet`).not.toBe("dynamic");
    }
  });

  it("gives every manifest row a reason a reviewer can read", () => {
    for (const surface of PUBLIC_SURFACES) {
      expect(typeof surface.note, surface.path).toBe("string");
      expect(surface.note?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
