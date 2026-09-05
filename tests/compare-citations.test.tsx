import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  { slug: "visualping", module: "~/routes/compare.visualping" },
  { slug: "visualping-ad-library", module: "~/routes/compare.visualping-ad-library" },
  { slug: "panoramata", module: "~/routes/compare.panoramata" },
  { slug: "adspyder", module: "~/routes/compare.adspyder" },
  { slug: "foreplay", module: "~/routes/compare.foreplay" },
  { slug: "foreplay-spyder", module: "~/routes/compare.foreplay-spyder" },
  { slug: "meta-ad-library", module: "~/routes/compare.meta-ad-library" },
  { slug: "magicbrief", module: "~/routes/compare.magicbrief" },
  { slug: "pulzifi", module: "~/routes/compare.pulzifi" },
  { slug: "spyland", module: "~/routes/compare.spyland" },
] as const;

async function renderPage(modulePath: string) {
  const { default: Route } = await import(modulePath);
  return renderToStaticMarkup(createElement(Route));
}

describe("compare pages citation footer", () => {
  for (const page of COMPARE_PAGES) {
    it(`/compare/${page.slug} renders the "Every claim on this page has a link" footer`, async () => {
      const markup = await renderPage(page.module);

      expect(markup).toContain("Every claim on this page has a link.");
    });

    it(`/compare/${page.slug} cites at least 2 unique first-party competitor sources in the footer`, async () => {
      const markup = await renderPage(page.module);

      // Extract all hrefs from the Sources footer section.
      // The footer renders <a href="..." rel="noreferrer" target="_blank">label</a> — claim
      const footerMatch = markup.match(/Every claim on this page has a link\.<\/h2>([\s\S]*?)<\/section>/);
      expect(footerMatch).not.toBeNull();
      const footerHtml = footerMatch![1];

      const hrefs = [...footerHtml.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
      const uniqueHrefs = new Set(hrefs);

      // All sources must be external (not 0509.io internal links)
      for (const href of uniqueHrefs) {
        expect(href).not.toContain("0509.io");
      }

      // ≥2 unique first-party competitor sources
      expect(uniqueHrefs.size).toBeGreaterThanOrEqual(2);
    });

    it(`/compare/${page.slug} has inline "Source:" links in the claim cards`, async () => {
      const markup = await renderPage(page.module);

      // Inline source links use the "Source: <a>label</a>" pattern
      expect(markup).toContain("Source:");
    });
  }
});
