import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pricingPlans, usageBundles } from "~/lib/pricing";

describe("marketing pricing latency", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("waits for a Dodo preview only up to the SSR bound, then falls back", async () => {
    const previewDodo0509PlanPrices = vi.fn(
      () => new Promise<never>(() => {}),
    );
    const commercialLaunch = {
      scoutSaleOpen: true,
      starterSaleOpen: true,
      agencySaleOpen: false,
    };
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));
    vi.doMock("~/lib/public-proof.server", () => ({
      loadPublicProofBrief: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/marketing");
    const start = Date.now();
    const result = await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/"),
    } as never);

    // The document waits only the bounded SSR window (2.5s), then degrades to
    // the honest checkout-localized fallback instead of blocking the page.
    expect(Date.now() - start).toBeGreaterThanOrEqual(2300);
    expect(result).toEqual({
      pricingPreview: { available: false },
      commercialLaunch,
      proofBrief: null,
    });
    expect(previewDodo0509PlanPrices).toHaveBeenCalledTimes(1);
    expect(publicCommercialLaunchSummary).toHaveBeenCalledWith({
      DODO_0509_API_KEY: "provider-key",
    });
  });

  it("renders real per-plan prices in the SSR document when the preview is available", async () => {
    const preview = {
      available: true,
      provider: "dodo",
      source: "dodo_checkout_preview",
      country: "US",
      adaptiveCurrency: true,
      feesInclusive: true,
      prices: {
        scout: {
          monthly: { display: "$19", amount: 1900, currency: "USD", billingCountry: "US" },
          yearly: { display: "$152", amount: 15200, currency: "USD", billingCountry: "US" },
        },
        starter: {
          monthly: { display: "$59", amount: 5900, currency: "USD", billingCountry: "US" },
          yearly: { display: "$472", amount: 47200, currency: "USD", billingCountry: "US" },
        },
        agency: {
          monthly: { display: "$199", amount: 19900, currency: "USD", billingCountry: "US" },
          yearly: { display: "$1,592", amount: 159200, currency: "USD", billingCountry: "US" },
        },
      },
      annualValidation: {
        scout: {
          valid: true,
          reason: "valid_4_months_free",
          monthlyAmount: 1900,
          annualAmount: 15200,
          expectedAnnualAmount: 15200,
          currency: "USD",
          billingCountry: "US",
        },
        starter: {
          valid: true,
          reason: "valid_4_months_free",
          monthlyAmount: 5900,
          annualAmount: 47200,
          expectedAnnualAmount: 47200,
          currency: "USD",
          billingCountry: "US",
        },
        agency: {
          valid: true,
          reason: "valid_4_months_free",
          monthlyAmount: 19900,
          annualAmount: 159200,
          expectedAnnualAmount: 159200,
          currency: "USD",
          billingCountry: "US",
        },
      },
      usageBundles: {},
    };
    const previewDodo0509PlanPrices = vi.fn().mockResolvedValue(preview);
    const publicCommercialLaunchSummary = vi.fn(() => ({
      scoutSaleOpen: true,
      starterSaleOpen: true,
      agencySaleOpen: false,
    }));

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));
    vi.doMock("~/lib/public-proof.server", () => ({
      loadPublicProofBrief: vi.fn().mockResolvedValue(null),
    }));

    const { loader } = await import("~/routes/marketing");
    const response = (await loader({
      context: { cloudflare: { env: {} } },
      request: new Request("https://0509.io/"),
    } as never)) as Response;

    expect(response.status).toBe(200);
    // Buyer-country prices must never be shared-cached: a DE/EUR variant could
    // otherwise be replayed for a US visitor.
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    const data = (await response.json()) as {
      pricingPreview: { prices?: Record<string, Record<string, { display: string }>> };
      commercialLaunch: { scoutSaleOpen: boolean };
    };
    expect(data.pricingPreview.prices?.scout?.monthly?.display).toBe("$19");
    expect(data.pricingPreview.prices?.starter?.monthly?.display).toBe("$59");
    expect(data.pricingPreview.prices?.agency?.monthly?.display).toBe("$199");
    expect(data.commercialLaunch.scoutSaleOpen).toBe(true);
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
