import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SITEMAP_PATHS } from "~/lib/seo";
import routes from "~/routes";
import { readFileSync } from "node:fs";

// The 13 /compare/* product pages the hub links to. Must stay in sync with
// SITEMAP_PATHS and routes.ts — the canary guards all three together.
const COMPARE_PAGES = [
  "compare/magicbrief",
  "compare/meta-ad-library",
  "compare/visualping",
  "compare/visualping-ad-library",
  "compare/spyland",
  "compare/pulzifi",
  "compare/foreplay",
  "compare/foreplay-spyder",
  "compare/panoramata",
  "compare/adspyder",
] as const;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
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

describe("/compare hub canary (issue #1470)", () => {
  it("registers the bare /compare route", () => {
    const routePaths = (routes as unknown as Array<{ path?: string }>)
      .filter((r) => r.path)
      .map((r) => r.path!);
    expect(routePaths).toContain("compare");
  });

  it("lists bare /compare in SITEMAP_PATHS", () => {
    expect(SITEMAP_PATHS).toContain("/compare");
  });

  it("renders a page with an h1 and links to every /compare/* product page", async () => {
    const { default: CompareIndexRoute } = await import("~/routes/compare");
    const markup = renderToStaticMarkup(createElement(CompareIndexRoute));

    // One plain h1, no skipped heading levels.
    expect(markup).toContain("<h1");
    expect(markup.match(/<h1/g)).toHaveLength(1);

    for (const page of COMPARE_PAGES) {
      expect(markup, `/compare hub links /${page}`).toContain(`href="/${page}"`);
    }
  });

  it("renders the MarketingNav and MarketingFooter shared chrome", async () => {
    const { default: CompareIndexRoute } = await import("~/routes/compare");
    const markup = renderToStaticMarkup(createElement(CompareIndexRoute));

    expect(markup).toContain("Five to Nine home");
    expect(markup).toContain("Search preview");
    expect(markup).toContain("Pricing");
    expect(markup).toContain("Five to Nine helps teams see competitor");
  });

  it("emits WebPage JSON-LD for /compare without pricing claims", async () => {
    const { default: CompareIndexRoute, meta } = await import("~/routes/compare");
    const markup = renderToStaticMarkup(createElement(CompareIndexRoute));

    const ldMatches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const blocks = ldMatches.map((m) => JSON.parse(m[1] ?? ""));

    const webPages = blocks.filter((b) => b["@type"] === "WebPage");
    expect(webPages).toHaveLength(1);
    expect(webPages[0]?.url).toBe("https://0509.io/compare");

    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toMatch(/[$₹€£]\s?\d/);
  });
});
