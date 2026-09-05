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

  it("does not promise automatic collection, board, or evidence transfer", async () => {
    const { default: CompareMagicBriefRoute } = await import("~/routes/compare.magicbrief");
    const markup = renderToStaticMarkup(createElement(CompareMagicBriefRoute));

    expect(markup).not.toContain("Bring your saved work");
    expect(markup).not.toContain("Saved ad library and boards");
    expect(markup).not.toContain("migrate your collections");
    expect(markup).not.toContain("set up your collections and watchlists");
    expect(markup).not.toContain("Collections — save winning ads");
  });

  it("distinguishes supported input, not-imported data, and the person-to-person fallback", async () => {
    const { default: CompareMagicBriefRoute } = await import("~/routes/compare.magicbrief");
    const markup = renderToStaticMarkup(createElement(CompareMagicBriefRoute));

    expect(markup).toContain("Bring your competitor list");
    expect(markup).toContain("Paste one domain, URL, or brand per line");
    expect(markup).toContain("What doesn\u2019t transfer");
    expect(markup).toContain("Collections and boards");
    expect(markup).toContain("Five to Nine doesn&#x27;t migrate them");
    expect(markup).toContain("Analytics and report history");
    expect(markup).toContain("aren&#x27;t imported");
    expect(markup).toContain("Historical screenshots and evidence");
    expect(markup).toContain("person to person");
    expect(markup).toContain("set up your watchlists with you");
  });

  it("keeps the search CTA and support contact intact", async () => {
    const { default: CompareMagicBriefRoute } = await import("~/routes/compare.magicbrief");
    const markup = renderToStaticMarkup(createElement(CompareMagicBriefRoute));

    expect(markup).toContain("Try it free, no account");
    expect(markup).toContain("aria-label=\"Competitor website\"");
    expect(markup).toContain("mailto:support@0509.io");
  });
});
