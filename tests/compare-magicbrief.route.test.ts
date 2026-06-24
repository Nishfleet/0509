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
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("WhatsApp delivery");
  });
});
