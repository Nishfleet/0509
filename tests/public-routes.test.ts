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
        DISALLOWED_PREFIXES.some(
          (prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`),
        );
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

  it("sitemap.xml lists every public path as an absolute url in a sitemaps.org urlset", () => {
    const body = sitemapXml("https://0509.io", PUBLIC_PATHS);
    expect(body).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    for (const p of PUBLIC_PATHS) {
      expect(body).toContain(`<loc>https://0509.io${p}</loc>`);
    }
    for (const entry of topLevel(routes)) {
      const path = "path" in entry ? entry.path : undefined;
      if (path === undefined || path === "*") continue;
      if (!(PUBLIC_PATHS as readonly string[]).includes(`/${path}`)) continue;
      expect(body).toContain(`<loc>https://0509.io/${path}</loc>`);
    }
  });

  it("sitemap.xml escapes xml-special characters in loc values", () => {
    expect(sitemapXml("https://x", ["/a&b"])).toContain("/a&amp;b");
  });

  it("keeps a noindex page out of the sitemap", () => {
    const file = join(REPO_ROOT, "public/index.html");
    const staticHome = existsSync(file) ? readFileSync(file, "utf8") : "";
    const noindex = /<meta\s+name="robots"\s+content="[^"]*noindex/.test(staticHome);
    expect((PUBLIC_PATHS as readonly string[]).includes("/")).toBe(!noindex);
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
