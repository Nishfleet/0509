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

  it("returns the homepage loader without waiting for a Dodo preview", async () => {
    const previewDodo0509PlanPrices = vi.fn(
      () => new Promise<never>(() => {}),
    );
    const commercialLaunch = {
      scoutSaleOpen: true,
      starterSaleOpen: true,
      agencySaleOpen: false,
    };
    const publicCommercialLaunchSummary = vi.fn(() => commercialLaunch);
    // The SSR preview is timeboxed; on timeout the loader keeps the published
    // anchors instead of hanging the homepage document.
    const promiseWithTimeout = vi.fn((_op: Promise<unknown>) =>
      Promise.reject(new Error("marketing pricing preview timed out")),
    );

    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DODO_0509_API_KEY: "provider-key" })),
    }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({ publicCommercialLaunchSummary }));
    vi.doMock("~/lib/fetch-timeout.server", () => ({ promiseWithTimeout }));

    const { loader } = await import("~/routes/marketing");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("marketing loader waited for pricing preview")),
        250,
      );
    });

    try {
      const result = await Promise.race([
        loader({
          context: { cloudflare: { env: {} } },
          request: new Request("https://0509.io/"),
        } as never),
        timeoutPromise,
      ]);

      expect(result).toEqual({
        pricingPreview: { available: false },
        commercialLaunch,
      });
      expect(previewDodo0509PlanPrices).toHaveBeenCalled();
      expect(promiseWithTimeout).toHaveBeenCalled();
      expect(publicCommercialLaunchSummary).toHaveBeenCalledWith({
        DODO_0509_API_KEY: "provider-key",
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
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
