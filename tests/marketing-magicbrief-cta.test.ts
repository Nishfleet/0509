import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: React.ReactNode; to?: string } & Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
      useNavigation: () => ({ state: "idle" }),
      useRouteLoaderData: () => ({ session: null, pricingPlans: [], usageBundles: [] }),
      useLoaderData: () => ({}),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderHomepageMarkup() {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

describe("homepage MagicBrief migration CTA", () => {
  it("keeps the migration guide link and the support contact", async () => {
    const markup = await renderHomepageMarkup();

    expect(markup).toContain('href="/compare/magicbrief"');
    expect(markup).toContain("migration guide");
    expect(markup).toContain("mailto:support@0509.io");
  });

  it("fails on the old overbroad promise that collections and watchlists are moved", async () => {
    const markup = await renderHomepageMarkup();

    expect(markup).not.toContain("help you move your collections and watchlists");
    expect(markup).not.toContain("move your collections");
    expect(markup).not.toContain("move your saved work");
  });

  it("states that the competitor list imports as watchlists and is set up with help", async () => {
    const markup = await renderHomepageMarkup();

    expect(markup).toContain("Your competitor list imports as watchlists");
    expect(markup).toContain("set them up with you");
  });

  it("states the not-imported boundary for collections, boards, analytics history, and past evidence", async () => {
    const markup = await renderHomepageMarkup();

    expect(markup).toContain("Collections, boards, analytics history, and past evidence do not transfer");
    expect(markup).toContain("recreate them with our help");
  });
});
