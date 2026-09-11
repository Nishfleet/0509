import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import routes from "~/routes";

/**
 * Issue #2885 — every sitemap section's parent path must resolve non-404.
 *
 * Before this suite the sitemap listed ~193 child URLs whose parents 404'd:
 * /guides, /timeline, /briefs, and /ads were dead ends for crawlers and
 * readers climbing one level up from an indexed page. The fix:
 *
 * - /ads → 301 to /brands (the live browse index)
 * - /briefs → 301 to /briefs/weekly (the only live brief surface)
 * - /guides → 200 thin index of the live guides
 * - /timeline → 200 index of domains with ≥1 recorded offer state
 *
 * The gate is mechanical: for each section parent, the route must be
 * registered in app/routes.ts (registered = serves; unregistered = the
 * not-found catch-all = 404), the redirect loaders must 301 to the right
 * place, the guides index must list exactly the sitemap's /guides/* set,
 * and the timeline index must reuse the sitemap's own non-empty gate.
 */

function registeredPath(path: string): { path: string; file: string } | undefined {
  const stack: Array<{ entry: (typeof routes)[number]; prefix: string }> = routes.map((entry) => ({ entry, prefix: "" }));
  while (stack.length) {
    const { entry, prefix } = stack.pop()!;
    const normalized = entry.path ? `${prefix}/${entry.path}` : null;
    if (normalized === path) return { path: normalized, file: entry.file ?? "" };
    if (entry.children) {
      stack.push(...entry.children.map((child) => ({ entry: child, prefix: normalized ?? "" })));
    }
  }
  return undefined;
}

const SECTION_PARENTS = ["/guides", "/timeline", "/briefs", "/ads"] as const;

describe("sitemap section parents resolve non-404 (issue #2885)", () => {
  it("registers every sitemap-derived section parent as a real route", () => {
    const unregistered = SECTION_PARENTS.filter((p) => !registeredPath(p));
    expect(unregistered).toEqual([]);
  });

  it("serves the section parents from the routes this issue ships", () => {
    expect(registeredPath("/ads")?.file).toBe("routes/ads-redirect.ts");
    expect(registeredPath("/briefs")?.file).toBe("routes/briefs-redirect.ts");
    expect(registeredPath("/guides")?.file).toBe("routes/guides.tsx");
    expect(registeredPath("/timeline")?.file).toBe("routes/timeline.tsx");
  });

  it.each([
    ["/ads?utm=1", "/brands?utm=1", "~/routes/ads-redirect"],
    ["/briefs?x=2", "/briefs/weekly?x=2", "~/routes/briefs-redirect"],
  ] as const)("301s %s to the canonical index, preserving the query", async (url, expectedLocation, modulePath) => {
    const { loader } = await import(modulePath);
    let caught: unknown;
    try {
      await loader({ request: new Request(`https://five-to-nine.test${url}`), params: {}, context: undefined });
    } catch (error) {
      caught = error;
    }
    const response = caught as Response;
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(expectedLocation);
  });

  it("guides index lists exactly the sitemap's /guides/* children", async () => {
    const { SITEMAP_PATHS } = await import("~/lib/seo");
    const { GUIDE_ENTRIES } = await import("~/routes/guides");
    const sitemapGuides = SITEMAP_PATHS.filter((p) => p.startsWith("/guides/")).sort();
    const hubGuides = GUIDE_ENTRIES.map((g) => g.href).sort();
    expect(hubGuides).toEqual(sitemapGuides);
  });

  it("timeline index lists only domains with ≥1 recorded offer state (the sitemap's own gate)", async () => {
    const sitemapTimelineEntries = [
      { path: "/timeline/nike.com", lastmod: "2026-09-01" },
      { path: "/timeline/adidas.com" },
    ];
    vi.doMock("~/lib/sitemap.server", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      loadIndexableTimelineEntries: vi.fn(async () => sitemapTimelineEntries),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    const { loader } = await import("~/routes/timeline");
    const data = await loader({
      request: new Request("https://five-to-nine.test/timeline"),
      params: {},
      context: undefined,
    } as never);
    expect(data.domains).toEqual([
      { domain: "nike.com", lastmod: "2026-09-01" },
      { domain: "adidas.com" },
    ]);
  });

  it("timeline index degrades to an honest empty 200 when the timeline read fails", async () => {
    vi.resetModules();
    vi.doMock("~/lib/sitemap.server", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      loadIndexableTimelineEntries: vi.fn(async () => {
        throw new Error("no such table: landing_page_snapshot");
      }),
    }));
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    const { loader } = await import("~/routes/timeline");
    const data = await loader({
      request: new Request("https://five-to-nine.test/timeline"),
      params: {},
      context: undefined,
    } as never);
    expect(data.degraded).toBe(true);
    expect(data.domains).toEqual([]);
  });

  it("timeline index serves an honest empty list when D1 is unavailable (no DB)", async () => {
    vi.resetModules();
    vi.doUnmock("~/lib/sitemap.server");
    vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => ({})) }));
    const { loader } = await import("~/routes/timeline");
    // env.DB undefined → loadIndexableTimelineEntries returns [] (no throw).
    const data = await loader({
      request: new Request("https://five-to-nine.test/timeline"),
      params: {},
      context: undefined,
    } as never);
    expect(data.degraded).toBe(false);
    expect(data.domains).toEqual([]);
  });
});
