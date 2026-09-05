import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockFormProps = { children?: React.ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: React.ReactNode; to?: string } & Record<string, unknown>;

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

beforeEach(() => {
  vi.resetModules();
  mockReactRouter();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
});

async function renderMarketing(): Promise<string> {
  const { default: MarketingRoute } = await import("~/routes/marketing");
  return renderToStaticMarkup(createElement(MarketingRoute));
}

// The homepage carries several pricing-note paragraphs; the MagicBrief CTA is
// the one that mentions the migration guide, so scope every assertion to it.
function magicbriefCtaBlock(markup: string): string {
  const paragraphs = markup.match(/<p class="ld-pricing-note">[\s\S]*?<\/p>/g) ?? [];
  const cta = paragraphs.find((paragraph) => paragraph.includes("MagicBrief"));
  expect(cta, "homepage must render the MagicBrief CTA paragraph").toBeDefined();
  return cta ?? "";
}

describe("anonymous homepage MagicBrief migration CTA", () => {
  it("states the supported boundary: competitor lists move or are set up as watchlists with help", async () => {
    const markup = await renderMarketing();
    const cta = magicbriefCtaBlock(markup);

    expect(cta).toContain("Competitor lists");
    expect(cta).toContain("moved or set up as watchlists with our help");
    expect(cta).toContain("set up your watchlists with you");
  });

  it("fails the old overbroad promise: collections are never offered as something we move", async () => {
    const markup = await renderMarketing();
    const cta = magicbriefCtaBlock(markup);

    expect(cta).not.toContain("move your collections");
    expect(cta).not.toContain("collections and watchlists");
    expect(cta).not.toContain("help you move your");
  });

  it("states the not-imported boundary: collections, boards, analytics history, and past evidence do not transfer", async () => {
    const markup = await renderMarketing();
    const cta = magicbriefCtaBlock(markup);

    expect(cta).toContain("collections, boards, analytics history, and past evidence");
    expect(cta).toContain("do not transfer");
    expect(cta).toContain("you recreate them with our help");
    expect(cta).not.toContain("move your collections and watchlists");
  });

  it("keeps the migration guide link and support contact", async () => {
    const markup = await renderMarketing();
    const cta = magicbriefCtaBlock(markup);

    expect(cta).toContain('href="/compare/magicbrief"');
    expect(cta).toContain("migration guide");
    expect(cta).toContain('href="mailto:support@0509.io"');
    expect(cta).toContain("support@0509.io");
  });
});
