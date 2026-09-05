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
  it("renders migration copy without Slack GA claims or automatic-transfer promises", async () => {
    const { default: CompareMagicBriefRoute } = await import("~/routes/compare.magicbrief");
    const markup = renderToStaticMarkup(createElement(CompareMagicBriefRoute));

    expect(markup).toContain("Moving from MagicBrief?");
    expect(markup).toContain("Meta ads tracking is labeled beta");
    expect(markup).toContain("Receipts for every move");
    expect(markup).not.toContain("Evidence over vibes");
    expect(markup).not.toContain("No screenshots, no claim");
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("WhatsApp delivery");

    // The old overclaim is gone: collections/boards and saved evidence are
    // never presented as items that transfer automatically.
    expect(markup).not.toContain("Bring your saved work");
    expect(markup).not.toContain("Saved ad library and boards");
    expect(markup).not.toContain("set up your collections");
    expect(markup).not.toContain("migrate your collections");
  });

  it("names supported input, not-imported data, and the person-to-person fallback", async () => {
    const { default: CompareMagicBriefRoute } = await import("~/routes/compare.magicbrief");
    const markup = renderToStaticMarkup(createElement(CompareMagicBriefRoute));

    // Supported: a generic competitor list becomes watchlists.
    expect(markup).toContain("Bring your competitor list");
    expect(markup).toContain("Competitor lists");
    expect(markup).toContain("one domain, URL, or brand name per line");
    expect(markup).toContain("notes, tags, and client columns");
    expect(markup).toContain('action="/search"');

    // Not imported: collections/boards, analytics history, and past evidence.
    expect(markup).toContain("Not imported");
    expect(markup).toContain("Collections and boards");
    expect(markup).toContain("Five to Nine doesn&#x27;t migrate them");
    expect(markup).toContain("Analytics and report history");
    expect(markup).toContain("aren&#x27;t imported");
    expect(markup).toContain("Historical screenshots");
    expect(markup).toContain("Past evidence isn&#x27;t preserved");
    expect(markup).toContain("No full MagicBrief export contract is verified");

    // Finished fallback: help moving, person to person, with recreation.
    expect(markup).toContain("person to person");
    expect(markup).toContain("help you recreate");
  });

  it("declares SEO meta without collection-transfer promises", async () => {
    const { meta } = await import("~/routes/compare.magicbrief");

    const tags = meta({} as never) as Array<Record<string, string>>;
    const description = tags.find((tag) => tag.name === "description")?.content;
    expect(description).toContain("Bring your competitor list");
    expect(description).toContain("aren't imported");
    expect(description).not.toContain("migrate your collections");
    expect(description).not.toContain("collections and watchlists");
  });
});
