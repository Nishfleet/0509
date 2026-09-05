import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pricingPlans, usageBundles } from "~/lib/pricing";

describe("marketing magicbrief migration CTA", () => {
  type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
  type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

  let loaderData: {
    pricingPreview: {
      available: boolean;
      prices?: Record<
        string,
        Partial<Record<"monthly" | "yearly", { display: string; amount: number; currency: string }>>
      >;
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

  async function renderRoute(): Promise<string> {
    const { default: MarketingRoute } = await import("~/routes/marketing");
    return renderToStaticMarkup(createElement(MarketingRoute));
  }

  it("states the supported transfer boundary and the not-imported list on the homepage", async () => {
    loaderData = {
      pricingPreview: { available: false },
      commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
    };

    const markup = await renderRoute();

    // Supported: the competitor list imports as watchlists, with help.
    expect(markup).toContain("Your competitor list imports as watchlists");
    expect(markup).toContain("set them up with you, person to person");
    // Not imported: collections, boards, analytics history, and past evidence.
    expect(markup).toContain("Collections, boards, analytics history, and past evidence do not transfer");
  });

  it("fails on the old overbroad promise that collections move with the import", async () => {
    loaderData = {
      pricingPreview: { available: false },
      commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
    };

    const markup = await renderRoute();

    // The pre-packet copy promised help moving "your collections and watchlists";
    // collections and saved evidence are not migrated, so that promise must stay out.
    expect(markup).not.toContain("move your collections");
    expect(markup).not.toContain("collections and watchlists");
    expect(markup).not.toContain("import your collections");
    expect(markup).not.toContain("bring your collections");
  });

  it("keeps the migration-guide link and support contact in the CTA", async () => {
    loaderData = {
      pricingPreview: { available: false },
      commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
    };

    const markup = await renderRoute();

    expect(markup).toContain('href="/compare/magicbrief"');
    expect(markup).toContain("migration guide");
    expect(markup).toContain("mailto:support@0509.io");
    expect(markup).toContain("Coming from MagicBrief");
  });
});
