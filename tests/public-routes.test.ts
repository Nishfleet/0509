import type { RouteConfigEntry } from "@react-router/dev/routes";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import routes from "../app/routes";
import { PLANS, TRIAL_DAYS } from "../app/lib/billing/plans";
import { LEGAL_UPDATED } from "../app/lib/legal/document";
import { SECURITY_UPDATED } from "../app/lib/legal/security";
import type { SourceRow, SourceSnapshot } from "../app/lib/source-pill-status";
import {
  AGENT_PATHS,
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

const SESSION_LAYOUT_FILES = new Set([
  "routes/app-layout.tsx",
  "routes/app-settings-layout.tsx",
  "routes/app-session-layout.tsx",
]);

const SESSION_GATE_ALLOWLIST: Readonly<Record<string, string>> = {
  "/login": "sign-in must load without a session",
  "/api/health": "liveness probe has no cookie",
  "/api/docs": "public OpenAPI explorer",
  "/onboarding": "first-run flow after sign-in, not under /app layouts",
  "/onboarding/competitors": "first-run flow after sign-in, not under /app layouts",
  "/onboarding/identity": "first-run flow after sign-in, not under /app layouts",
  "/onboarding/plan": "first-run flow after sign-in, not under /app layouts; the route calls requireSession itself",
  "/oauth/authorize": "MCP OAuth consent; the route calls requireFreshSession itself",
  "/app/changes/:signalId/:side":
    "published landing shots load signed out; the route calls requireSession for the rest",
};

function isSessionExempt(urlPath: string) {
  return (
    urlPath === "/u" ||
    urlPath.startsWith("/u/") ||
    urlPath === "/v" ||
    urlPath.startsWith("/v/") ||
    urlPath === "/api/auth" ||
    urlPath.startsWith("/api/auth/") ||
    urlPath === "/api/webhooks" ||
    urlPath.startsWith("/api/webhooks/") ||
    urlPath === "/api/v1" ||
    urlPath.startsWith("/api/v1/")
  );
}

function unguardedDisallowed(entries: RouteConfigEntry[], layouts: readonly string[] = [], parentPath = ""): string[] {
  const missing: string[] = [];
  for (const entry of entries) {
    const isPathlessLayout =
      entry.path === undefined && entry.index !== true && entry.file !== undefined && entry.children !== undefined;
    const nextLayouts = isPathlessLayout ? [...layouts, entry.file] : layouts;
    const ownPath = entry.path ?? parentPath;
    if (entry.children !== undefined) {
      missing.push(...unguardedDisallowed(entry.children, nextLayouts, ownPath));
    }
    const urlPath =
      entry.index === true
        ? parentPath === ""
          ? "/"
          : `/${parentPath}`
        : entry.path !== undefined && entry.path !== "*"
          ? `/${entry.path}`
          : null;
    if (urlPath === null) continue;
    if (!isDisallowed(urlPath) || isSessionExempt(urlPath) || urlPath in SESSION_GATE_ALLOWLIST) continue;
    if (!nextLayouts.some((file) => SESSION_LAYOUT_FILES.has(file))) missing.push(urlPath);
  }
  return [...new Set(missing)];
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const isDisallowed = (urlPath: string) => DISALLOWED_PREFIXES.some((prefix) => urlPath.startsWith(prefix));

const withoutComments = (source: string) =>
  source.replace(
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,
    (_match: string, literal: string | undefined) => literal ?? " ",
  );
const modulesDeclaringNoindex = (module: string) =>
  (withoutComments(module).match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g) ?? []).some((literal) =>
    /\bnoindex\b/i.test(literal),
  );

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
      const classified =
        (PUBLIC_PATHS as readonly string[]).includes(urlPath) ||
        (AGENT_PATHS as readonly string[]).includes(urlPath) ||
        isDisallowed(urlPath);
      expect(classified, `route "${path}" is not classified in app/lib/public-routes.ts`).toBe(true);
    }
  });

  it("puts every private disallowed route under a session layout or an explicit allowlist", () => {
    expect(unguardedDisallowed(routes)).toEqual([]);
  });

  it("fails a private index route that is not under a session layout", () => {
    const tree: RouteConfigEntry[] = [
      {
        path: "app/hidden",
        file: "routes/hidden.tsx",
        children: [{ index: true, file: "routes/hidden-index.tsx" }],
      },
    ];
    expect(unguardedDisallowed(tree)).toEqual(["/app/hidden"]);
  });

  it("sitemap.xml dates the legal pages by their last update and leaves other urls undated", () => {
    const body = sitemapXml("https://0509.io", SITEMAP_PATHS, SITEMAP_LASTMOD);
    for (const path of ["/privacy", "/terms"]) {
      expect(body).toContain(`<loc>https://0509.io${path}</loc><lastmod>${LEGAL_UPDATED}</lastmod>`);
    }
    expect(body).toContain(`<loc>https://0509.io/security</loc><lastmod>${SECURITY_UPDATED}</lastmod>`);
    expect(body).toContain("<loc>https://0509.io/llms.txt</loc></url>");
  });

  it("robots.txt disallows the manifest prefixes and names the sitemap", () => {
    const body = robotsTxt("https://0509.io");
    expect(body).toContain("Disallow: /app");
    expect(body).toContain("Disallow: /api");
    expect(body).toContain("Disallow: /u/");
    expect(body).toContain("Disallow: /v/");
    expect(body).toContain("Allow: /mcp");
    expect(body).toContain("Allow: /api/v1/openapi.json");
    expect(body).not.toContain("Disallow: /mcp");
    expect(body).toContain("Sitemap: https://0509.io/sitemap.xml");
  });

  it("never links from /llms.txt a url that robots.txt disallows", () => {
    const rules = robotsTxt("https://0509.io")
      .split("\n")
      .flatMap((line) => {
        const match = /^(Allow|Disallow): (\/.*)$/.exec(line);
        return match === null ? [] : [{ allow: match[1] === "Allow", path: match[2] as string }];
      });
    const verdict = (urlPath: string) =>
      rules
        .filter((rule) => urlPath.startsWith(rule.path))
        .reduce<{
          allow: boolean;
          length: number;
        }>((best, rule) => (rule.path.length > best.length ? { allow: rule.allow, length: rule.path.length } : best), {
          allow: true,
          length: -1,
        }).allow;
    const linked = [...llmsTxt("https://0509.io", []).matchAll(/\]\(https:\/\/0509\.io(\/[^)]*)\)/g)].map(
      (match) => match[1] as string,
    );
    expect(linked.length).toBeGreaterThan(0);
    for (const urlPath of linked) {
      expect(verdict(urlPath), `/llms.txt links ${urlPath}, which robots.txt disallows`).toBe(true);
    }
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
    for (const path of SITEMAP_PATHS as readonly string[]) {
      expect(isDisallowed(path), `sitemap path "${path}" is disallowed by robots.txt`).toBe(false);
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

  it("serves / from the landing route and lists it in the sitemap", () => {
    const home = topLevel(routes).find((entry) => entry.index === true);
    expect(home?.file).toBe("routes/landing.tsx");
    expect(SITEMAP_PATHS as readonly string[]).toContain("/");
    expect(existsSync(join(REPO_ROOT, "public/index.html"))).toBe(false);
  });

  it("lists /status and /security as public pages that robots.txt allows", () => {
    for (const path of ["/status", "/security"]) {
      expect(PUBLIC_PATHS as readonly string[]).toContain(path);
      expect(isDisallowed(path)).toBe(false);
    }
    expect(robotsTxt("https://0509.io")).not.toMatch(/^Disallow: \/(status|security)$/m);
  });

  it("llms.txt never says public sources twice when no source is answering", () => {
    const summary = llmsTxt("https://0509.io", [], NOW).split("\n")[2] ?? "";
    expect(summary).toContain("watches their public sources, ranks you");
    expect(summary).not.toContain("public sources from public sources");
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

  it("lists /pricing as a public, sitemapped page whose summary names every plan and the trial", () => {
    expect(PUBLIC_PATHS as readonly string[]).toContain("/pricing");
    expect(SITEMAP_PATHS as readonly string[]).toContain("/pricing");
    expect(isDisallowed("/pricing")).toBe(false);
    const body = llmsTxt("https://0509.io", healthyRegistry(), NOW);
    const line = body.split("\n").find((row) => row.startsWith("- [Pricing](https://0509.io/pricing)"));
    expect(line).toBeDefined();
    for (const plan of PLANS) {
      expect(line).toContain(plan.name);
      expect(body).toContain(`${plan.name} €${String(plan.monthlyPriceEur)}/month`);
    }
    expect(line).toContain(`${String(TRIAL_DAYS)}-day trial`);
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
    expect(body).toContain("- Mentions: News (not answering today: slow to answer)");
    expect(body).toContain("- Mentions: YouTube (no data yet)");
    expect(body).toContain("Some sources aren't answering today; those lines say so.");
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
