import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #1863: every /compare/:slug page must carry a `data-source-url`
// attribute on its primary claim section pointing to a live, verifiable
// first-party competitor source. The live HTTP 200 check is run separately
// (see the issue's `verify:` block); this test pins the attribute's presence,
// shape, and that it points to a first-party source URL declared in the page's
// own citations JSON — not 0509.io, not a relative path, not a third-party
// review site. A page that drops the attribute or points it at the wrong URL
// fails here before it can ship a phantom comparison.

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

const COMPARE_PAGES = [
  { slug: "visualping", module: "~/routes/compare.visualping", citations: "~/data/compare/visualping-citations.json" },
  {
    slug: "visualping-ad-libraries",
    module: "~/routes/compare.visualping-ad-libraries",
    citations: "~/data/compare/visualping-ad-library-citations.json",
  },
  { slug: "panoramata", module: "~/routes/compare.panoramata", citations: "~/data/compare/panoramata-citations.json" },
  { slug: "adspyder", module: "~/routes/compare.adspyder", citations: "~/data/compare/adspyder-citations.json" },
  { slug: "adspy", module: "~/routes/compare.adspy", citations: "~/data/compare/adspy-citations.json" },
  { slug: "foreplay", module: "~/routes/compare.foreplay", citations: "~/data/compare/foreplay-citations.json" },
  {
    slug: "foreplay-spyder",
    module: "~/routes/compare.foreplay-spyder",
    citations: "~/data/compare/foreplay-spyder-citations.json",
  },
  {
    slug: "meta-ad-library",
    module: "~/routes/compare.meta-ad-library",
    citations: "~/data/compare/meta-ad-library-citations.json",
  },
  { slug: "pulzifi", module: "~/routes/compare.pulzifi", citations: "~/data/compare/pulzifi-citations.json" },
  { slug: "spyland", module: "~/routes/compare.spyland", citations: "~/data/compare/spyland-citations.json" },
  { slug: "keeptabz", module: "~/routes/compare.keeptabz", citations: "~/data/compare/keeptabz-citations.json" },
  { slug: "gethookd", module: "~/routes/compare.gethookd", citations: "~/data/compare/gethookd-citations.json" },
  { slug: "bigspy", module: "~/routes/compare.bigspy", citations: "~/data/compare/bigspy-citations.json" },
  { slug: "minea", module: "~/routes/compare.minea", citations: "~/data/compare/minea-citations.json" },
  { slug: "poweradspy", module: "~/routes/compare.poweradspy", citations: "~/data/compare/poweradspy-citations.json" },
] as const;

async function renderPage(modulePath: string) {
  const { default: Route } = await import(modulePath);
  return renderToStaticMarkup(createElement(Route));
}

function extractDataSourceUrl(markup: string): string | null {
  // React renders data-* attributes verbatim; capture the first occurrence,
  // which lives on the primary claim section.
  const match = markup.match(/data-source-url="([^"]+)"/);
  return match ? match[1] : null;
}

describe("compare pages first-party source attribution (issue #1863)", () => {
  for (const page of COMPARE_PAGES) {
    it(`/compare/${page.slug} has a data-source-url on its primary claim section`, async () => {
      const markup = await renderPage(page.module);
      const url = extractDataSourceUrl(markup);

      expect(url, "primary claim section must carry data-source-url").not.toBeNull();
    });

    it(`/compare/${page.slug} data-source-url is an https first-party URL (not 0509.io)`, async () => {
      const markup = await renderPage(page.module);
      const url = extractDataSourceUrl(markup);

      expect(url).not.toBeNull();
      expect(url!.startsWith("https://")).toBe(true);
      expect(url!).not.toContain("0509.io");
      expect(url!).not.toContain("0509.in");
    });

    it(`/compare/${page.slug} data-source-url matches a source declared in its citations JSON`, async () => {
      const markup = await renderPage(page.module);
      const url = extractDataSourceUrl(markup);

      const citations = (await import(page.citations)) as {
        sources: readonly { href: string }[];
      };
      const declaredHrefs = citations.sources.map((source) => source.href);

      expect(declaredHrefs, "citations JSON must declare at least one source").not.toHaveLength(0);
      expect(declaredHrefs, `data-source-url (${url}) must be one of the page's declared sources`).toContain(url);
    });

    it(`/compare/${page.slug} renders an "as of <date>" beside the primary claim (issue #2958)`, async () => {
      const markup = await renderPage(page.module);
      const url = extractDataSourceUrl(markup);

      const citations = (await import(page.citations)) as {
        sources: readonly { href: string; checked: string }[];
      };
      const source = citations.sources.find((candidate) => candidate.href === url);

      expect(source, "primary source must be declared in the citations JSON").toBeTruthy();
      expect(
        markup,
        `page must show the claim's as-of date (as of ${source!.checked})`,
      ).toContain(`as of ${source!.checked}`);
    });
  }
});

describe("pricing competitor price anchors (issue #2139)", () => {
  it("every vendor row has a matching entry in the sources doc with a URL and a date", async () => {
    const { COMPETITOR_PRICE_ANCHORS } = await import("~/components/pricing-section");
    const doc = readFileSync("docs/compare-pricing-sources.md", "utf8");

    expect(COMPETITOR_PRICE_ANCHORS.length).toBeGreaterThan(0);
    for (const anchor of COMPETITOR_PRICE_ANCHORS) {
      expect(anchor.sourceUrl.startsWith("https://"), `${anchor.vendor} source URL`).toBe(true);
      expect(anchor.checked, `${anchor.vendor} checked date`).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(doc, `${anchor.vendor} named in sources doc`).toContain(anchor.vendor);
      expect(doc, `${anchor.vendor} source URL in sources doc`).toContain(anchor.sourceUrl);
      expect(doc, `${anchor.vendor} checked date in sources doc`).toContain(anchor.checked);
    }
  });
});
