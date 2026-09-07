import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pricingPlans, usageBundles } from "~/lib/pricing";

describe("marketing MagicBrief migration CTA", () => {
  type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
  type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

  const loaderData = {
    pricingPreview: { available: false },
    commercialLaunch: { scoutSaleOpen: true, starterSaleOpen: true, agencySaleOpen: false },
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

  async function renderHomepage(): Promise<string> {
    const { default: MarketingRoute } = await import("~/routes/marketing");
    return renderToStaticMarkup(createElement(MarketingRoute));
  }

  it("fails the old overbroad promise that collections and watchlists move over", async () => {
    const markup = await renderHomepage();

    // The previous CTA said "we'll help you move your collections and watchlists".
    // No sentence may imply collections or saved evidence are migrated.
    expect(markup).not.toContain("move your collections and watchlists");
    expect(markup).not.toContain("help you move your");
    expect(markup).not.toContain("move your collections");
  });

  it("states the supported boundary: competitor lists import as watchlists with help", async () => {
    const markup = await renderHomepage();

    expect(markup).toContain("Your competitor list imports as");
    expect(markup).toContain("imports as watchlists");
    expect(markup).toContain("set up your watchlists with you, person to person");
  });

  it("states the not-imported boundary: collections, boards, analytics history, past evidence", async () => {
    const markup = await renderHomepage();

    expect(markup).toContain("Collections, boards,");
    expect(markup).toContain("analytics history, and past evidence");
    expect(markup).toContain("are not migrated by Five to Nine");
    expect(markup).toContain("you recreate them with our help");
  });

  it("keeps the migration guide link and support contact on the CTA", async () => {
    const markup = await renderHomepage();

    expect(markup).toContain('href="/compare/magicbrief"');
    expect(markup).toContain("migration guide");
    expect(markup).toContain("mailto:support@0509.io");
    expect(markup).toContain("support@0509.io");
  });

  it("puts a Moving from MagicBrief callout in the homepage hero", async () => {
    const markup = await renderHomepage();

    expect(markup).toContain('class="f9-announcement f9-migration-callout"');
    expect(markup).toContain("Moving from MagicBrief?");
    expect(markup).toContain("Bring your competitor list. Gain the receipts.");
    expect(markup).toContain('href="/compare/magicbrief"');
    expect(markup).not.toContain("full migration");
    expect(markup).not.toContain("we migrate everything");
  });

  it("reuses the migration page headline instead of inventing new copy", () => {
    const marketing = readFileSync("app/routes/marketing.tsx", "utf8");
    const compare = readFileSync("app/routes/compare.magicbrief.tsx", "utf8");

    expect(compare).toContain(
      "Moving from MagicBrief? Bring your competitor list. Gain the receipts.",
    );
    expect(marketing).toContain("Moving from MagicBrief?");
    expect(marketing).toContain("Bring your competitor list. Gain the receipts.");
    expect(marketing).toContain('to="/compare/magicbrief"');
  });
});
