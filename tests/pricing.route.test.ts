import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pricingPlans, usageBundles } from "~/lib/pricing";

const commercialLaunch = {
  scoutSaleOpen: true,
  starterSaleOpen: true,
  agencySaleOpen: false,
};

describe("pricing route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const availablePreview = {
    available: true,
    provider: "dodo",
    source: "dodo_checkout_preview",
    country: "US",
    adaptiveCurrency: true,
    feesInclusive: true,
    prices: {
      starter: {
        monthly: { display: "$99", amount: 9900, currency: "USD", billingCountry: "US" },
      },
    },
    annualValidation: {},
    usageBundles: {},
  };

  it("is registered as a route and included in the sitemap", async () => {
    const routes = readFileSync("app/routes.ts", "utf8");
    expect(routes).toContain('route("pricing", "routes/pricing.tsx")');

    const { publicSeoFileForPathname } = await import("~/lib/seo");
    const sitemap = publicSeoFileForPathname("/sitemap.xml");
    // The /pricing route is registered and the sitemap now lists it; the live
    // Worker bundle must still be deployed for the public URL to resolve.
    expect(sitemap?.body).toContain("<loc>https://0509.io/pricing</loc>");
  });

  it("declares the canonical URL and public SEO meta", async () => {
    const { links, meta } = await import("~/routes/pricing");

    expect(links()).toEqual([{ rel: "canonical", href: "https://0509.io/pricing" }]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe("Pricing | Five to Nine");
    expect(tags).toContainEqual({
      property: "og:url",
      content: "https://0509.io/pricing",
    });
  });

  it("publishes the Dodo pricing preview in the loader when it responds within the SSR bound", async () => {
    const previewDodo0509PlanPrices = vi.fn().mockResolvedValue(availablePreview);
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));

    const { headers, loader } = await import("~/routes/pricing");
    const response = (await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/pricing"),
    } as never)) as Response;

    expect(previewDodo0509PlanPrices).toHaveBeenCalledTimes(1);
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("vary")).toContain("cookie");
    const documentHeaders = headers({
      loaderHeaders: response.headers,
      parentHeaders: new Headers(),
      actionHeaders: new Headers(),
      errorHeaders: undefined,
    });
    expect(documentHeaders.get("cache-control")).toBe("private, max-age=300");
    await expect(response.json()).resolves.toEqual({
      pricingPreview: availablePreview,
      commercialLaunch,
    });
  });

  it("falls back to the checkout-localized preview when Dodo is unavailable", async () => {
    const previewDodo0509PlanPrices = vi.fn().mockResolvedValue({ available: false });
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));

    const { loader } = await import("~/routes/pricing");
    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/pricing"),
    } as never);

    expect(result).toEqual({
      pricingPreview: { available: false },
      commercialLaunch,
    });
  });
});

describe("pricing section render smoke", () => {
  type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

  const rootData = {
    session: null,
    pricingPlans: pricingPlans(),
    usageBundles: usageBundles(),
  };

  const routeData = {
    pricingPreview: { available: false },
    commercialLaunch,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        useRouteLoaderData: () => rootData,
        useLoaderData: () => routeData,
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("react-router");
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("renders plan cards and billing FAQ in the cold anonymous fallback", async () => {
    const { PricingSection } = await import("~/components/pricing-section");
    const markup = renderToStaticMarkup(
      createElement(PricingSection, {
        commercialLaunch: {
          scoutSaleOpen: true,
          starterSaleOpen: true,
          agencySaleOpen: false,
        },
        initialPricingPreview: null,
      }),
    );

    expect(markup).toContain("Scout");
    expect(markup).toContain("Starter");
    expect(markup).toContain("Agency");
    // Published USD anchor prices render from first paint, before the live
    // Dodo preview resolves.
    expect(markup).toContain("$11 USD/mo");
    expect(markup).toContain("$59 USD/mo");
    expect(markup).toContain("$199 USD/mo");
    expect(markup).toContain("$59 USD");
    expect(markup).toContain("$179 USD");
    expect(markup).toContain("$599 USD");
    expect(markup).toContain("Common billing questions");
    // Homepage reuses this section and already has its own hero h1.
    expect(markup).toContain("<h2>Choose the monitoring rhythm your team needs.</h2>");
    expect(markup).not.toMatch(/<h1\b/);
  });

  it("renders a single plain-text h1 in the route SSR output", async () => {
    const { default: PricingRoute } = await import("~/routes/pricing");
    const markup = renderToStaticMarkup(createElement(PricingRoute));

    const h1Matches = markup.match(/<h1\b[^>]*>[^<]+<\/h1>/g) ?? [];
    expect(h1Matches).toHaveLength(1);
    expect(h1Matches[0]).toBe(
      "<h1>Choose the monitoring rhythm your team needs.</h1>",
    );
  });

  it("publishes 7 or more Offer blocks in EUR on /pricing JSON-LD for issue #1503", async () => {
    const { default: PricingRoute } = await import("~/routes/pricing");
    const markup = renderToStaticMarkup(createElement(PricingRoute));

    // The issue's verify command grep-counts "@type":"Offer" (with
    // optional whitespace) and requires at least 7, plus at least one
    // priceCurrency="EUR". Render the SSR markup here and apply the
    // same grep contract so the regression guard fires without the
    // network round-trip — exactly the same shape as
    //   curl -sS https://0509.io/pricing | grep -oE '"@type"\s*:\s*"Offer"' | wc -l
    const offerCount = (markup.match(/"@type"\s*:\s*"Offer"/g) ?? []).length;
    expect(offerCount).toBeGreaterThanOrEqual(7);
    expect(markup).toMatch(/"priceCurrency"\s*:\s*"EUR"/);
    // Free is part of the 7, so it must be the published 0 offer row.
    expect(markup).toMatch(/"name"\s*:\s*"Free"/);
  });
});
