import { createElement } from "react";
import { mockReactRouter } from "./helpers/mock-react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_BRAND_PAGE_DOMAINS } from "~/lib/demo-brand-pages";

// Issue 2124: every sitemap-canonical /compare/* page must carry at least one
// interior link to a live /ads/:domain page whose domain is a tracked demo
// brand, so a comparison-page visitor can see the product working instead of
// only reading claims. A comparison page that only asserts "domain paste +
// proof" without showing one proof page is parity copy.
const SITEMAP_CANONICAL_COMPARE_PAGES = [
  "meta-ad-library",
  "visualping-ad-libraries",
  "spyland",
  "pulzifi",
  "foreplay-spyder",
  "panoramata",
  "adspyder",
] as const;

beforeEach(() => {
  vi.resetModules();
  mockReactRouter({
    loaderData: () => undefined,
    loader: () => ({ featuredAdsLink: null }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadCompareModule(slug: string) {
  switch (slug) {
    case "meta-ad-library":
      return import("~/routes/compare.meta-ad-library");
    case "visualping-ad-libraries":
      return import("~/routes/compare.visualping-ad-libraries");
    case "spyland":
      return import("~/routes/compare.spyland");
    case "pulzifi":
      return import("~/routes/compare.pulzifi");
    case "foreplay-spyder":
      return import("~/routes/compare.foreplay-spyder");
    case "panoramata":
      return import("~/routes/compare.panoramata");
    case "adspyder":
      return import("~/routes/compare.adspyder");
    default:
      throw new Error(`unknown compare slug: ${slug}`);
  }
}

function extractAdsHrefs(markup: string): string[] {
  return [...markup.matchAll(/href="(\/ads\/[^"]+)"/g)].map((m) => m[1] ?? "");
}

function extractTimelineHrefs(markup: string): string[] {
  return [...markup.matchAll(/href="(\/timeline\/[^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("sitemap-canonical compare pages carry a live-brand worked example (issue 2124)", () => {
  it.each(SITEMAP_CANONICAL_COMPARE_PAGES)(
    "/compare/%s renders the live-brand proof block with a tracked /ads/<domain> link and offer history",
    async (slug) => {
      const mod = await loadCompareModule(slug);
      const markup = renderToStaticMarkup(createElement(mod.default));

      // The block must be present and labelled as the issue requires.
      expect(markup, `/compare/${slug} must render the "See it on a live brand" block`).toContain(
        "See it on a live brand",
      );

      const adsHrefs = extractAdsHrefs(markup);
      expect(adsHrefs, `/compare/${slug} must link at least one /ads/:domain page`).not.toHaveLength(0);

      const trackedDomains = DEMO_BRAND_PAGE_DOMAINS.map((domain) => `/ads/${domain}`);
      const trackedHrefs = adsHrefs.filter((href) => trackedDomains.includes(href));
      expect(
        trackedHrefs,
        `/compare/${slug} must link a tracked demo brand /ads/:domain page`,
      ).not.toHaveLength(0);

      // The seed brand (nike.com) has a live /timeline/:domain offer-history
      // page, so the block must include it as a second link labelled offer
      // history (issue 2124 accept).
      const timelineHrefs = extractTimelineHrefs(markup);
      const trackedTimeline = timelineHrefs.filter((href) =>
        DEMO_BRAND_PAGE_DOMAINS.some((domain) => href === `/timeline/${domain}`),
      );
      expect(
        trackedTimeline,
        `/compare/${slug} must link the tracked brand's /timeline/:domain offer history`,
      ).not.toHaveLength(0);
      expect(markup, `/compare/${slug} must label the timeline link as offer history`).toContain(
        "offer history",
      );
    },
  );

  it("the /compare hub also links a tracked demo brand /ads/:domain page", async () => {
    const { default: CompareIndexRoute } = await import("~/routes/compare");
    const markup = renderToStaticMarkup(createElement(CompareIndexRoute));

    expect(markup, "/compare hub must render the \"See it on a live brand\" block").toContain(
      "See it on a live brand",
    );

    const adsHrefs = extractAdsHrefs(markup);
    const trackedDomains = DEMO_BRAND_PAGE_DOMAINS.map((domain) => `/ads/${domain}`);
    const trackedHrefs = adsHrefs.filter((href) => trackedDomains.includes(href));
    expect(trackedHrefs, "/compare hub must link a tracked demo brand /ads/:domain page").not.toHaveLength(0);
  });
});
