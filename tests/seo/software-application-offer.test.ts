import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockReactRouter } from "../helpers/mock-react-router";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function parseLdJsonBlocks(markup: string): Array<Record<string, unknown>> {
  const matches = [...markup.matchAll(/type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  return matches.map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
}

function mockMarketingRouter() {
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
      useLoaderData: vi.fn().mockReturnValue({
        pricingPreview: { available: false },
        commercialLaunch: {
          scoutSaleOpen: true,
          starterSaleOpen: true,
          agencySaleOpen: false,
        },
        proofBrief: null,
        indexableAdsLinks: [],
        changeMark: null,
        featuredDomain: "nike.com",
      }),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("SoftwareApplication / WebApplication Offer JSON-LD (issue #3372)", () => {
  it("emits a WebApplication Offer{price:0, USD} block on /", async () => {
    mockMarketingRouter();
    const { webApplicationJsonLd } = await import("~/lib/seo");
    const entity = JSON.parse(JSON.stringify(webApplicationJsonLd())) as Record<string, unknown>;

    expect(entity).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Five to Nine",
      url: "https://0509.io",
      applicationCategory: "BusinessApplication",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));
    const blocks = parseLdJsonBlocks(markup);
    const webApps = blocks.filter((block) => block["@type"] === "WebApplication");
    expect(webApps).toHaveLength(1);
    expect(webApps[0]).toMatchObject(entity);

    const organization = JSON.stringify(blocks.find((block) => block["@type"] === "Organization"));
    const website = JSON.stringify(blocks.find((block) => block["@type"] === "WebSite"));
    expect(organization).not.toMatch(/"price"/);
    expect(website).not.toMatch(/"price"/);
  });

  it("emits the rival as SoftwareApplication with Offer and aggregateRating on /compare/adspy", async () => {
    mockReactRouter({ loader: { featuredAdsLink: null } });
    const routeModule = (await import("~/routes/compare.adspy")) as { default: () => ReactNode };
    const markup = renderToStaticMarkup(createElement(routeModule.default));
    const blocks = parseLdJsonBlocks(markup);
    const webPage = blocks.find((block) => block["@type"] === "WebPage");
    const rival = webPage?.mainEntity as Record<string, unknown> | undefined;

    expect(rival).toMatchObject({
      "@type": "SoftwareApplication",
      name: "AdSpy",
      applicationCategory: "BusinessApplication",
      offers: {
        "@type": "Offer",
        price: "149",
        priceCurrency: "USD",
      },
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "2.4",
        bestRating: "5",
      },
    });
    expect(markup).toContain("$149");
    expect(markup).toContain("2.4/5");
    expect(JSON.stringify(rival)).not.toMatch(/reviewCount/i);
  });

  it.each([
    "compare.foreplay-spyder",
    "compare.adspyder",
    "compare.visualping-ad-libraries",
    "compare.keeptabz",
    "compare.bigspy",
    "compare.minea",
    "compare.poweradspy",
    "compare.panoramata",
    "compare.meta-ad-library",
  ])("%s SoftwareApplication Offer numbers also appear in the visible page", async (routeId) => {
    mockReactRouter({ loader: { featuredAdsLink: null } });
    const routeModule = (await import(`~/routes/${routeId}`)) as { default: () => ReactNode };
    const markup = renderToStaticMarkup(createElement(routeModule.default));
    const webPage = parseLdJsonBlocks(markup).find((block) => block["@type"] === "WebPage");
    const rival = webPage?.mainEntity as Record<string, unknown> | undefined;
    const offers = rival?.offers as Record<string, unknown> | undefined;

    expect(rival?.["@type"]).toBe("SoftwareApplication");
    expect(offers, `${routeId} is missing an Offer on SoftwareApplication`).toBeDefined();
    expect(offers?.["@type"]).toMatch(/^(Offer|AggregateOffer)$/);
    for (const amount of [offers?.price, offers?.lowPrice, offers?.highPrice]) {
      if (typeof amount !== "string") continue;
      if (amount === "0") {
        expect(markup.toLowerCase()).toMatch(/free/);
      } else {
        expect(markup).toContain(amount);
      }
    }
  });
});
