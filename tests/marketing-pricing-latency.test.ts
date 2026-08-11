import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pricingPlans, usageBundles } from "~/lib/pricing";

describe("marketing pricing SSR", () => {
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

  it("publishes the Dodo pricing preview in the loader when it responds within the SSR bound", async () => {
    const previewDodo0509PlanPrices = vi.fn().mockResolvedValue(availablePreview);
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));

    const { headers, loader } = await import("~/routes/marketing");
    const response = (await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/"),
    } as never)) as Response;

    expect(previewDodo0509PlanPrices).toHaveBeenCalledTimes(1);
    expect(response).toBeInstanceOf(Response);
    // Country-specific prices are embedded in this HTML: it must be
    // browser-only so a shared cache never replays one country's prices
    // for another visitor.
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(response.headers.get("vary")).toContain("cookie");
    // React Router only merges Set-Cookie from loader responses into the
    // document; the route-level headers export must carry the rest through.
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
    expect(publicCommercialLaunchSummary).toHaveBeenCalledWith({
      DODO_0509_API_KEY: "provider-key",
    });
  });

  it("falls back to the checkout-localized preview when Dodo exceeds the SSR bound", async () => {
    vi.useFakeTimers();
    const previewDodo0509PlanPrices = vi.fn(() => new Promise<never>(() => {}));
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));

    const { loader } = await import("~/routes/marketing");
    const loading = loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/"),
    } as never);

    await vi.advanceTimersByTimeAsync(2_500);
    const result = await loading;

    // The homepage document never blocks on a slow Dodo preview: it degrades
    // to the honest checkout-localized fallback and the client-side
    // /api/pricing-preview fetch takes over near the fold.
    expect(result).toEqual({
      pricingPreview: { available: false },
      commercialLaunch,
    });
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

  it("shows the monthly cadence note on every card in the cold anonymous fallback", async () => {
    loaderData = {
      pricingPreview: { available: false },
      commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
    };

    const markup = await renderRoute();

    // Scout, Starter, and Agency each render one plan card.
    expect(planCardNotes(markup)).toEqual(["Billed monthly", "Billed monthly", "Billed monthly"]);
    // Prices stay localized and no annual-only savings claim appears when
    // annual checkout is not available.
    expect(markup).toContain("Localized at checkout");
    expect(markup).not.toContain("Billed annually");
    expect(markup).not.toContain("4 months free");
  });

  it("keeps the annual price note only on plans with annual checkout available", async () => {
    const valid = { valid: true, reason: "valid_4_months_free" };
    loaderData = {
      pricingPreview: {
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
      },
      commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
    };

    const markup = await renderRoute();

    // Monthly is selected: sale-open plans keep the truthful annual price
    // note, while the held Agency card (no annual checkout) stays on the
    // monthly cadence note.
    expect(planCardNotes(markup)).toEqual(["$392 annual", "$792 annual", "Billed monthly"]);
    // The annual savings offer stays visible on the toggle when annual is
    // actually available, and the annual-only claim never leaks into cards.
    expect(markup).toContain("4 months free");
    expect(markup).not.toContain("Billed annually");
  });
});
