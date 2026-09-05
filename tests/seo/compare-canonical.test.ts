import { readFileSync } from "node:fs";

import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalUrl,
  COMPARE_CANONICAL_TARGETS,
  publicSeoFileForPathname,
} from "~/lib/seo";

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({
        children,
        to,
        ...props
      }: { children?: ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useRouteLoaderData: () => undefined,
      useLoaderData: () => ({ featuredAdsLink: null }),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function sitemapComparePaths(): string[] {
  const body = publicSeoFileForPathname("/sitemap.xml")?.body ?? "";
  return [...body.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1] ?? "")
    .filter((loc) => loc.includes("/compare/"))
    .map((loc) => new URL(loc).pathname)
    .sort();
}

/** Concrete loser route modules; static paths so Vite resolves them. */
async function importLoserRoute(slug: string) {
  switch (slug) {
    case "visualping":
      return import("~/routes/compare.visualping");
    case "foreplay":
      return import("~/routes/compare.foreplay");
    default:
      throw new Error(`unknown canonicalized loser slug: ${slug}`);
  }
}

describe("compare canonical consolidation (issue #1481)", () => {
  it("lists only the canonical winner of each duplicate pair in the sitemap", () => {
    const sitemapPaths = sitemapComparePaths();

    for (const [loser, winner] of Object.entries(COMPARE_CANONICAL_TARGETS)) {
      expect(sitemapPaths, `${winner} dropped from the sitemap`).toContain(winner);
      expect(sitemapPaths, `${loser} must leave the sitemap`).not.toContain(loser);
    }
  });

  it("keeps every sitemap /compare/* URL unique with no sibling prefix duplicate", () => {
    const sitemapPaths = sitemapComparePaths();

    expect(new Set(sitemapPaths).size).toBe(sitemapPaths.length);

    // A URL that is a strict prefix of another /compare/* URL still in the
    // sitemap is the duplicate-content shape: when the specific URL is
    // indexed, the generic one must not be. The bare /compare hub is the
    // cluster index and legitimately prefixes every product page, so it is
    // excluded from the check.
    for (const path of sitemapPaths) {
      if (path === "/compare") continue;
      const moreSpecificSiblingIndexed = sitemapPaths.some(
        (other) => other !== path && other.startsWith(`${path}/`),
      );
      expect(
        moreSpecificSiblingIndexed,
        `${path} is a duplicate of an indexed, more specific /compare/* sibling`,
      ).toBe(false);
    }
  });

  it("points each loser canonical at the winner and keeps the loser a live renderable page", async () => {
    for (const [loser, winner] of Object.entries(COMPARE_CANONICAL_TARGETS)) {
      const slug = loser.replace(/^\/compare\//, "");
      const mod = await importLoserRoute(slug);
      const links = (mod as { links: () => Array<{ rel: string; href: string }> }).links;

      expect(links(), `${loser} must carry the ${winner} canonical`).toEqual([
        { rel: "canonical", href: canonicalUrl(winner) },
      ]);
    }

    // The losers stay live HTTP-200 pages — the route stays registered and
    // renders its H1 (never 404) so existing backlinks and /switch links keep
    // working while Google consolidates each pair on the winner.
    const routesSource = readFileSync("app/routes.ts", "utf8");
    for (const loser of Object.keys(COMPARE_CANONICAL_TARGETS)) {
      const slug = loser.replace(/^\/compare\//, "");
      expect(routesSource, `${loser} route must stay registered`).toContain(
        `route("compare/${slug}", "routes/compare.${slug}.tsx")`,
      );

      const mod = await importLoserRoute(slug);
      const markup = renderToStaticMarkup(
        createElement((mod as { default: () => ReactElement }).default),
      );
      expect(markup, `${loser} must render a real page`).toContain("<h1");
    }
  });
});
