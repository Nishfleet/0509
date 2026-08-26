import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  indexableAdsLinkFromPath,
  pickFeaturedAdsInternalLink,
  type IndexableAdsLink,
} from "~/lib/ads-internal-links";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const nykaa: IndexableAdsLink = {
  domain: "nykaa.com",
  path: "/ads/nykaa.com",
  name: "Nykaa",
};
const glossier: IndexableAdsLink = {
  domain: "glossier.com",
  path: "/ads/glossier.com",
  name: "Glossier",
};

function mockReactRouter(loaderData: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
      useRouteLoaderData: vi.fn().mockReturnValue({
        pricingPlans: [],
        usageBundles: [],
        session: null,
      }),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("indexable ads link helpers", () => {
  it("accepts only /ads/:domain paths", () => {
    expect(indexableAdsLinkFromPath("/ads/nykaa.com")).toEqual(nykaa);
    expect(indexableAdsLinkFromPath("/ads/nykaa.com/extra")).toBeNull();
    expect(indexableAdsLinkFromPath("/search")).toBeNull();
    expect(indexableAdsLinkFromPath("/ads/")).toBeNull();
  });

  it("prefers the featured domain when it is in the indexable set", () => {
    expect(pickFeaturedAdsInternalLink([glossier, nykaa], "nykaa.com")).toEqual(nykaa);
    expect(pickFeaturedAdsInternalLink([glossier], "nykaa.com")).toEqual(glossier);
    expect(pickFeaturedAdsInternalLink([], "nykaa.com")).toBeNull();
  });
});

describe("internal /ads/:domain links on public funnel pages", () => {
  it("renders an indexable /ads/:domain anchor on the homepage", async () => {
    mockReactRouter({
      pricingPreview: { available: false },
      commercialLaunch: {
        scoutSaleOpen: true,
        starterSaleOpen: true,
        agencySaleOpen: false,
      },
      proofBrief: null,
      indexableAdsLinks: [nykaa, glossier],
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).toContain('href="/ads/nykaa.com"');
  });

  it("renders Browse tracked competitors links on /competitor-monitoring", async () => {
    mockReactRouter({
      proofBrief: null,
      indexableAdsLinks: [nykaa, glossier],
    });

    const { default: CompetitorMonitoringRoute } = await import("~/routes/competitor-monitoring");
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringRoute));

    expect(markup).toContain("Browse tracked competitors");
    expect(markup).toContain('href="/ads/nykaa.com"');
    expect(markup).toContain('href="/ads/glossier.com"');
  });

  it("does not invent /ads links on /competitor-monitoring when none are indexable", async () => {
    mockReactRouter({
      proofBrief: null,
      indexableAdsLinks: [],
    });

    const { default: CompetitorMonitoringRoute } = await import("~/routes/competitor-monitoring");
    const markup = renderToStaticMarkup(createElement(CompetitorMonitoringRoute));

    expect(markup).not.toContain("Browse tracked competitors");
    expect(markup).not.toMatch(/href="\/ads\/[^"]+"/);
  });

  it("renders a brand ads link on a /compare route when an indexable page exists", async () => {
    mockReactRouter({ featuredAdsLink: nykaa });

    const { default: CompareVisualpingRoute } = await import("~/routes/compare.visualping");
    const markup = renderToStaticMarkup(createElement(CompareVisualpingRoute));

    expect(markup).toContain('href="/ads/nykaa.com"');
    expect(markup).toMatch(/See Nykaa(?:'|&#x27;|&apos;)s ads on Five to Nine/);
  });

  it("falls back to /search on a /compare route when no indexable brand page exists", async () => {
    mockReactRouter({ featuredAdsLink: null });

    const { default: CompareVisualpingRoute } = await import("~/routes/compare.visualping");
    const markup = renderToStaticMarkup(createElement(CompareVisualpingRoute));

    expect(markup).not.toMatch(/href="\/ads\/[^"]+"/);
    expect(markup).toContain("See competitor ads on Five to Nine");
    expect(markup).toContain('href="/search"');
  });
});
