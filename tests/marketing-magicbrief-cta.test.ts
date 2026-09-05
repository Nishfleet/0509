import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUPPORT_EMAIL } from "~/lib/support";

type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function mockReactRouter() {
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
      }),
    };
  });
}

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

beforeEach(() => {
  vi.resetModules();
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

describe("anonymous homepage MagicBrief migration CTA", () => {
  it("states the supported boundary: competitor lists import as watchlists with help", async () => {
    const markup = await renderMarketing();

    expect(markup).toContain("migration guide");
    expect(markup).toContain('href="/compare/magicbrief"');
    expect(markup).toContain("Your competitor list imports as watchlists");
    expect(markup).toContain("help you set them up");
    expect(markup).toContain(`mailto:${SUPPORT_EMAIL}`);
  });

  it("states collections, boards, analytics history, and past evidence do not transfer", async () => {
    const markup = await renderMarketing();

    expect(markup).toContain(
      "Collections, boards, analytics history, and past evidence do not transfer",
    );
    expect(markup).toContain("you recreate them with our help");
  });

  it("no longer promises that collections or saved evidence move", async () => {
    const markup = await renderMarketing();

    // The old overbroad promise ("we'll help you move your collections and
    // watchlists") implied collections transfer through the migration.
    expect(markup).not.toContain("help you move your collections and watchlists");
    expect(markup).not.toContain("move your collections");
    expect(markup).not.toContain("collections and watchlists");
  });
});
