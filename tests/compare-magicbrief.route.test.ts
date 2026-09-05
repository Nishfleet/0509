import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Form: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("compare magicbrief route", () => {
  it("renders migration copy without Slack GA claims", async () => {
    const { default: CompareMagicBriefRoute } = await import("~/routes/compare.magicbrief");
    const markup = renderToStaticMarkup(createElement(CompareMagicBriefRoute));

    expect(markup).toContain("Moving from MagicBrief?");
    expect(markup).toContain("Meta ads tracking is labeled beta");
    expect(markup).toContain("Receipts for every move");
    expect(markup).not.toContain("Evidence over vibes");
    expect(markup).not.toContain("No screenshots, no claim");
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("WhatsApp delivery");
  });

  it("draws the migration boundary: watchlists import, collections and evidence do not", async () => {
    const { default: CompareMagicBriefRoute, pageDescription } = await import(
      "~/routes/compare.magicbrief"
    );
    const markup = renderToStaticMarkup(createElement(CompareMagicBriefRoute));

    expect(pageDescription).not.toContain("migrate your collections");
    expect(pageDescription).toContain("person-to-person fallback");

    expect(markup).not.toContain("Bring your saved work");
    expect(markup).not.toContain("Saved ad library and boards");
    expect(markup).not.toContain("Collections — save winning ads");
    expect(markup).not.toContain("set up your collections and watchlists");

    expect(markup).toContain("Bring your competitor list. Gain the receipts.");
    expect(markup).toContain("one domain, URL, or brand name per line");
    expect(markup).toContain("the setup import creates your watchlists");

    expect(markup).toContain("What doesn\u2019t transfer.");
    expect(markup).toContain("Five to Nine does not migrate them");
    expect(markup).toContain("recreate any numbers you need in your own reports");
    expect(markup).toContain("fresh screenshots, page text, and links as evidence");

    expect(markup).toContain("set up your watchlists with you");
    expect(markup).toContain("collections and evidence start fresh inside Five to Nine");
  });
});
