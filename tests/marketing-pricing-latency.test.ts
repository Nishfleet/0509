import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pricingPlans, usageBundles } from "~/lib/pricing";
import type { LocalPricingPreview } from "~/components/pricing-section";

describe("marketing pricing is client-fetched", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const commercialLaunch = {
    scoutSaleOpen: true,
    starterSaleOpen: true,
    agencySaleOpen: false,
  };

  const expectedLoaderData = {
    // The route declares the field for shape parity with /pricing, but the
    // homepage never resolves a preview: it is always the sentinel.
    pricingPreview: { available: false },
    commercialLaunch,
    proofBrief: null,
    indexableAdsLinks: [],
    changeMark: null,
    featuredDomain: "nike.com",
  };

  it("keeps Dodo out of the homepage loader so `/` can be shared-cached", async () => {
    const previewDodo0509PlanPrices = vi.fn();
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));

    const marketing = await import("~/routes/marketing");
    const result = await marketing.loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/"),
    } as never);

    // Issue #2389: buyer-country prices embedded in this document were the
    // only reason the one public page that could be shared-cached was pinned
    // to `private, max-age=300`. The loader no longer calls Dodo, so it
    // returns plain loader data — never a Response carrying its own
    // cache-control. With no route-set cache-control in play, the worker
    // stamps the shared policy for `/` (asserted in
    // tests/worker-security-headers.test.ts). This route must never grow a
    // `headers` export again: that export was the only way a private
    // cache-control reached the document, so a future one would silently
    // un-cache `/` without failing any assertion here.
    expect(previewDodo0509PlanPrices).not.toHaveBeenCalled();
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toEqual(expectedLoaderData);
    expect("headers" in marketing).toBe(false);
    expect(publicCommercialLaunchSummary).toHaveBeenCalledWith({
      DODO_0509_API_KEY: "provider-key",
    });
  });

  it("never waits on a Dodo preview, so a slow provider cannot hold the document open", async () => {
    const previewDodo0509PlanPrices = vi.fn(() => new Promise<never>(() => {}));
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));
    vi.doMock("~/lib/public-proof.server", () => ({
      loadPublicProofBrief: vi.fn().mockResolvedValue(null),
      featuredWebsiteForVisitorCountry: vi.fn(() => "nike.com"),
      PUBLIC_HOME_NEUTRAL_FEATURED_WEBSITE: "nike.com",
    }));

    const { loader } = await import("~/routes/marketing");
    const start = Date.now();
    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/"),
    } as never);
    const elapsed = Date.now() - start;

    // The old 2.5s `pricingPreviewWithinBound` race is gone: a provider call
    // that never settles cannot delay the document, because the provider is
    // never called from this route at all.
    expect(elapsed).toBeLessThan(2_000);
    expect(previewDodo0509PlanPrices).not.toHaveBeenCalled();
    expect(result).toEqual(expectedLoaderData);
  });
});

describe("marketing pricing monthly cadence note", () => {
  type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
  type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

  type LocalPreviewPrices = Partial<
    Record<
      string,
      Partial<Record<"monthly" | "yearly", { display: string; amount: number; currency: string }>>
    >
  >;

  let loaderData: {
    pricingPreview: {
      available: boolean;
      prices?: LocalPreviewPrices;
      annualValidation?: Record<string, { valid: boolean; reason: string }>;
    };
    commercialLaunch: { scoutSaleOpen: boolean; starterSaleOpen: boolean; agencySaleOpen: boolean };
  };

  const rootData = {
    session: null,
    pricingPlans: pricingPlans(),
    usageBundles: usageBundles(),
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");
      return {
        ...actual,
        useLoaderData: () => loaderData,
        useRouteLoaderData: () => rootData,
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
      };
    });
    vi.doMock("~/components/marketing-nav", () => ({
      MarketingNav: () => createElement("nav", { "aria-label": "Primary" }),
    }));
    vi.doMock("~/components/marketing-footer", () => ({
      MarketingFooter: () => createElement("footer"),
    }));
    vi.doMock("~/components/submit-button", () => ({
      SubmitButton: ({ children }: { children?: ReactNode }) =>
        createElement("button", null, children),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function planCardNotes(markup: string): string[] {
    const cards = [...markup.matchAll(/<article class="f9-commerce-card[^"]*">[\s\S]*?<\/article>/g)];
    return cards.map((card) => card[0].match(/<small>([\s\S]*?)<\/small>/)?.[1].trim() ?? "");
  }

  async function renderRoute(): Promise<string> {
    const { default: MarketingRoute } = await import("~/routes/marketing");
    return renderToStaticMarkup(createElement(MarketingRoute));
  }

  async function renderPricingSection(
    initialPricingPreview: LocalPricingPreview | null,
  ): Promise<string> {
    const { PricingSection } = await import("~/components/pricing-section");
    return renderToStaticMarkup(
      createElement(PricingSection, {
        commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
        initialPricingPreview,
      }),
    );
  }

  it("shows the monthly cadence note on every card in the cold anonymous fallback", async () => {
    loaderData = {
      pricingPreview: { available: false },
      commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
    };

    const markup = await renderRoute();

    // Free, Scout, Starter, and Agency each render one plan card; the Free
    // card's sub-label is its static "free, forever" (issue #1499).
    expect(planCardNotes(markup)).toEqual([
      "free, forever",
      "Billed monthly",
      "Billed monthly",
      "Billed monthly",
    ]);
    // Published USD anchor prices render from first paint, and the annual
    // toggle is usable (annual = 8x monthly = 4 months free).
    expect(markup).toContain("$11 USD");
    expect(markup).toContain("$59 USD");
    expect(markup).toContain("$199 USD");
    expect(markup).toContain("4 months free");
    expect(markup).not.toContain("Billed annually");
  });

  it("keeps the annual price note only on plans with annual checkout available", async () => {
    const valid = { valid: true, reason: "valid_4_months_free" };

    // The resolved-preview render is exercised directly here: /pricing still
    // resolves the preview server-side and hands it to the section, while the
    // home route now leaves pricing to the client fetch (issue #2389).
    const markup = await renderPricingSection({
      available: true,
      prices: {
        scout: {
          monthly: { display: "$49", amount: 4900, currency: "USD" },
          yearly: { display: "$392", amount: 39200, currency: "USD" },
        },
        starter: {
          monthly: { display: "$99", amount: 9900, currency: "USD" },
          yearly: { display: "$792", amount: 79200, currency: "USD" },
        },
        agency: {
          monthly: { display: "$249", amount: 24900, currency: "USD" },
          yearly: { display: "$1992", amount: 199200, currency: "USD" },
        },
      },
      annualValidation: {
        scout: valid,
        starter: valid,
        agency: { valid: false, reason: "amount_mismatch" },
      },
    });

    // Monthly is selected: sale-open plans keep the truthful annual price
    // note, while the held Agency card (no annual checkout) stays on the
    // monthly cadence note. The Free card's sub-label stays static.
    expect(planCardNotes(markup)).toEqual([
      "free, forever",
      "$392 annual",
      "$792 annual",
      "Billed monthly",
    ]);
    // The annual savings offer stays visible on the toggle when annual is
    // actually available, and the annual-only claim never leaks into cards.
    expect(markup).toContain("4 months free");
    expect(markup).not.toContain("Billed annually");
  });
});
