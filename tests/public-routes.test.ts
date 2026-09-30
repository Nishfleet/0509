import type { RouteConfigEntry } from "@react-router/dev/routes";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import routes from "../app/routes";
import { LEGAL_UPDATED } from "../app/lib/legal/document";
import type { SourceRow, SourceSnapshot } from "../app/components/source-pill";
import {
  DISALLOWED_PREFIXES,
  MCP_URL,
  PUBLIC_PATHS,
  SITEMAP_LASTMOD,
  SITEMAP_PATHS,
  llmsTxt,
  robotsTxt,
  sitemapXml,
  type LlmsTxtSource,
} from "../app/lib/public-routes";

function topLevel(entries: RouteConfigEntry[]): RouteConfigEntry[] {
  return entries.flatMap((entry) => (entry.path === undefined && entry.children ? topLevel(entry.children) : [entry]));
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const isDisallowed = (urlPath: string) =>
  DISALLOWED_PREFIXES.some((prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`));

// A robots directive is a robots <meta> tag in a document, and a string
// literal in a module: a JSX attribute value, a template literal, or a plain
// literal. Reading only string literals in a module is what keeps a "robots"
// spelled as an identifier or a type out; reading each literal whole is what
// keeps `content={cond ? "noindex" : "index, follow"}` in.
// Comments are cut only where they are comments: the string-literal branch is
// matched first and returned untouched, so the "//" in an https:// literal
// cannot swallow the rest of its line and hide a directive below it.
const withoutComments = (source: string) =>
  source.replace(
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,
    (_match: string, literal: string | undefined) => literal ?? " ",
  );
const documentsDeclaringNoindex = (document: string) =>
  (withoutComments(document).match(/<meta\b[^>]*>/gi) ?? [])
    .filter((tag) => /\bname\s*=\s*["']robots["']/i.test(tag))
    .some((tag) => /\bnoindex\b/i.test(tag));
const modulesDeclaringNoindex = (module: string) =>
  (withoutComments(module).match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g) ?? []).some((literal) =>
    /\bnoindex\b/i.test(literal),
  );
// The two modules read for a noindex: the route's own module, and app/root.tsx,
// the document React Router wraps every route in. A meta() composed further out
// (app/lib/legal/meta.ts builds the legal pages' meta) is past this scan's
// reach; the served document is what e2e/seo.spec.ts fetches and reads.
const servingSources = (route: RouteConfigEntry) =>
  [join("app", route.file), join("app", "root.tsx")].map((file) => [
    file,
    modulesDeclaringNoindex(readFileSync(join(REPO_ROOT, file), "utf8")),
  ]);

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
      const classified = (PUBLIC_PATHS as readonly string[]).includes(urlPath) || isDisallowed(urlPath);
      expect(classified, `route "${path}" is not classified in app/lib/public-routes.ts`).toBe(true);
    }
  });

  it("sitemap.xml dates the legal pages by their last update and leaves other urls undated", () => {
    const body = sitemapXml("https://0509.io", SITEMAP_PATHS, SITEMAP_LASTMOD);
    for (const path of ["/privacy", "/terms"]) {
      expect(body).toContain(`<loc>https://0509.io${path}</loc><lastmod>${LEGAL_UPDATED}</lastmod>`);
    }
    expect(body).toContain("<loc>https://0509.io/llms.txt</loc></url>");
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
    expect(body).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
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

  // 0509#5648: /llms.txt was 200, robots-allowed, indexable and absent from the
  // sitemap, so a crawler that starts at the sitemap never learned of it. Both
  // halves of that failure are checked here, one direction each.
  it("names /llms.txt in the sitemap", () => {
    expect(SITEMAP_PATHS as readonly string[], "/llms.txt is missing from SITEMAP_PATHS").toContain("/llms.txt");
  });

  it("sitemaps every page /llms.txt links with a summary", () => {
    for (const path of PUBLIC_PATHS) {
      expect(SITEMAP_PATHS as readonly string[], `${path} is a public page missing from the sitemap`).toContain(path);
    }
  });

  it("keeps every SITEMAP_PATHS member public, not just a route", () => {
    for (const path of SITEMAP_PATHS) {
      expect(
        (PUBLIC_PATHS as readonly string[]).includes(path) || path === "/llms.txt",
        `sitemap path "${path}" is public neither as a page /llms.txt links nor as the agent manifest`,
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
      expect(isDisallowed(path), `sitemap path "${path}" is disallowed by robots.txt`).toBe(false);
      if (path === "/" && existsSync(join(REPO_ROOT, "public/index.html"))) {
        // "/" is the static rebuild notice until the landing ships an index
        // route; the document that serves it is the one read for noindex.
        expect(
          documentsDeclaringNoindex(readFileSync(join(REPO_ROOT, "public/index.html"), "utf8")),
          "the document serving / declares a robots noindex",
        ).toBe(false);
        continue;
      }
      const route = routesByUrl.get(path);
      assert(route !== undefined, `sitemap path "${path}" is not a route in app/routes.ts`);
      expect(
        Object.fromEntries(servingSources(route)),
        `the route module or the root layout for "${path}" declares a robots noindex`,
      ).toEqual({
        [join("app", route.file)]: false,
        [join("app", "root.tsx")]: false,
      });
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
    const body = llmsTxt("https://0509.io", healthyRegistry(), NOW);
    expect(body.startsWith("# Five to Nine\n\n> ")).toBe(true);
    expect(body).toContain("## Pages");
    expect(body).toContain(MCP_URL);
    expect(body).toContain("- Site changes: Homepage\n");
    expect(body).toContain("- Mentions: News\n");
    expect(body).toContain("- Mentions: Hacker News\n");
    expect(body).toContain("- Mentions: YouTube\n");
    expect(body).not.toContain("not answering today");
    for (const p of PUBLIC_PATHS) {
      expect(body).toMatch(new RegExp(`^- \\[[^\\]]+\\]\\(https://0509\\.io${p}\\): \\S`, "m"));
    }
  });

  it("qualifies a mixed live registry at the line, and does not drop the line", () => {
    const body = llmsTxt(
      "https://0509.io",
      [
        registryEntry("site.web", "web", {}, FRESH),
        registryEntry("hn.algolia", "hn", {}, FRESH),
        registryEntry("gdelt.doc", "gdelt", { degraded_reason: "timed out", last_good_at: null }, FRESH),
        registryEntry("youtube.channel_rss", "youtube", { last_good_at: null }, null),
      ],
      NOW,
    );
    expect(body).toMatch(/^- Site changes: Homepage$/m);
    expect(body).toMatch(/^- Mentions: Hacker News$/m);
    expect(body).toContain("- Mentions: News (degraded: timed out — not answering today)");
    expect(body).toContain("- Mentions: YouTube (no data yet)");
    expect(body).toContain("Some sources are not answering today; those lines say so.");
    expect(body).toContain("- Your own site: Breakage alerts (Starter and up)");
  });

  it("omits a disabled registry source from the watches list", () => {
    const body = llmsTxt(
      "https://0509.io",
      [
        registryEntry("site.web", "web", { is_enabled: 0 }, FRESH),
        registryEntry("hn.algolia", "hn", {}, FRESH),
        registryEntry("gdelt.doc", "gdelt", {}, FRESH),
        registryEntry("youtube.channel_rss", "youtube", {}, FRESH),
      ],
      NOW,
    );
    expect(body).not.toContain("Site changes: Homepage");
    expect(body).toMatch(/^- Mentions: Hacker News$/m);
    expect(body).not.toContain("not answering today");
  });
});

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const FRESH: SourceSnapshot = {
  item_count: 4,
  fetched_at: "2026-09-28T11:00:00.000Z",
  canary_count: 1,
};

function registryEntry(
  key: string,
  platform: string,
  extra: Partial<SourceRow>,
  snapshot: SourceSnapshot | null,
): LlmsTxtSource {
  return {
    source: { key, platform, is_enabled: 1, ...extra },
    snapshot,
  };
}

function healthyRegistry(): readonly LlmsTxtSource[] {
  return [
    registryEntry("site.web", "web", {}, FRESH),
    registryEntry("hn.algolia", "hn", {}, FRESH),
    registryEntry("gdelt.doc", "gdelt", {}, FRESH),
    registryEntry("youtube.channel_rss", "youtube", {}, FRESH),
  ];
}
