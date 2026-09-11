import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #2835: /compare/pulzifi and /compare/spyland were flagged as comparison
// pages against vendors with no verifiable primary source. The resolution keeps
// both pages: pulzifi.com and spyland.ing are live vendor sites with public
// pricing, re-verified live on 2026-09-11. This test pins the kept-state end
// condition — each page must carry a cited first-party source whose `checked`
// date is on/after the issue's verification date (a stale pre-issue citation
// fails here), the rendered sources footer must link the vendor's own domain,
// the sources doc must record every cited URL and its check date, and both
// paths must stay in the sitemap.

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

// The date this issue's live re-verification ran. A citation whose `checked`
// predates it is the stale research the issue flagged, not the fix.
const VERIFIED_AT = "2026-09-11";

const VERIFIED_COMPARE_PAGES = [
  {
    slug: "pulzifi",
    module: "~/routes/compare.pulzifi",
    citations: "~/data/compare/pulzifi-citations.json",
    vendorDomain: "pulzifi.com",
    sourceDoc: "docs/compare-pulzifi-source.md",
  },
  {
    slug: "spyland",
    module: "~/routes/compare.spyland",
    citations: "~/data/compare/spyland-citations.json",
    vendorDomain: "spyland.ing",
    sourceDoc: "docs/compare-spyland-source.md",
  },
] as const;

interface CitationSource {
  id: string;
  href: string;
  label: string;
  checked: string;
  claim: string;
}

async function renderPage(modulePath: string) {
  const { default: Route } = await import(modulePath);
  return renderToStaticMarkup(createElement(Route));
}

describe("compare phantom vendors (issue #2835)", () => {
  for (const page of VERIFIED_COMPARE_PAGES) {
    it(`/compare/${page.slug} cites at least one first-party source on the vendor's own domain`, async () => {
      const citations = (await import(page.citations)) as { sources: readonly CitationSource[] };

      const firstParty = citations.sources.filter((source) => source.href.includes(page.vendorDomain));
      expect(firstParty.length, `${page.slug} has no citation on ${page.vendorDomain}`).toBeGreaterThanOrEqual(1);
    });

    it(`/compare/${page.slug} citations were verified live on/after ${VERIFIED_AT}`, async () => {
      const citations = (await import(page.citations)) as { sources: readonly CitationSource[] };

      expect(citations.sources.length).toBeGreaterThanOrEqual(2);
      for (const source of citations.sources) {
        expect(source.checked, `${source.id} checked date`).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
        expect(
          source.checked >= VERIFIED_AT,
          `${source.id} checked ${source.checked} predates the issue #2835 re-verification (${VERIFIED_AT})`,
        ).toBe(true);
      }
    });

    it(`/compare/${page.slug} renders the vendor's primary source in the sources footer`, async () => {
      const markup = await renderPage(page.module);

      const footerMatch = markup.match(/Every claim on this page has a link\.<\/h2>([\s\S]*?)<\/section>/);
      expect(footerMatch, `${page.slug} renders no sources footer`).not.toBeNull();
      const footerHtml = footerMatch![1];

      const hrefs = [...footerHtml.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
      expect(
        hrefs.some((href) => href.includes(page.vendorDomain)),
        `${page.slug} sources footer does not link ${page.vendorDomain}`,
      ).toBe(true);
    });

    it(`/compare/${page.slug} sources doc records every cited URL and check date`, async () => {
      const doc = readFileSync(page.sourceDoc, "utf8");
      const citations = (await import(page.citations)) as { sources: readonly CitationSource[] };

      for (const source of citations.sources) {
        expect(doc, `${page.sourceDoc} must record ${source.href}`).toContain(source.href);
        expect(doc, `${page.sourceDoc} must record the check date for ${source.href}`).toContain(
          source.checked,
        );
      }
    });
  }

  it("keeps both verified compare pages in the sitemap", async () => {
    const { SITEMAP_PATHS } = await import("~/lib/seo");

    expect(SITEMAP_PATHS).toContain("/compare/pulzifi");
    expect(SITEMAP_PATHS).toContain("/compare/spyland");
  });

  it("registers both EN routes and their locale buyer-surface children", async () => {
    const routes = (await import("~/routes")).default;
    const routeFiles = routes.flatMap(function collect(route): string[] {
      const file = "file" in route && typeof route.file === "string" ? [route.file] : [];
      const children = "children" in route && Array.isArray(route.children) ? route.children.flatMap(collect) : [];
      return [...file, ...children];
    });

    for (const file of [
      "routes/compare.pulzifi.tsx",
      "routes/compare.spyland.tsx",
      "routes/$locale.compare.pulzifi.tsx",
      "routes/$locale.compare.spyland.tsx",
    ]) {
      expect(routeFiles, `${file} unregistered`).toContain(file);
    }
  });
});
