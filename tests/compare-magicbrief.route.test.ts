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
  it("renders the honest migration boundary without automatic-transfer overclaims", async () => {
    const { default: CompareMagicBriefRoute } = await import("~/routes/compare.magicbrief");
    const markup = renderToStaticMarkup(createElement(CompareMagicBriefRoute));

    // Page identity and truthful product claims stay intact.
    expect(markup).toContain("Moving from MagicBrief?");
    expect(markup).toContain("Meta ads tracking is labeled beta");
    expect(markup).toContain("Receipts for every move");
    expect(markup).toContain("Try it free, no account");
    expect(markup).toContain('action="/search"');
    expect(markup).toContain("support@0509.io");

    // Supported generic competitor-list input.
    expect(markup).toContain("What transfers.");
    expect(markup).toContain("Your competitor list");
    expect(markup).toContain("The setup import turns it into watchlists");
    expect(markup).toContain("CSV with the right headers");
    expect(markup).toContain("never silently dropped");

    // Not imported: collections/boards, analytics history, historical evidence.
    expect(markup).toContain("What doesn’t transfer.");
    expect(markup).toContain("Collections and boards");
    expect(markup).toContain("Five to Nine does not migrate them");
    expect(markup).toContain("Analytics and report history");
    expect(markup).toContain("Historical screenshots and saved evidence");
    expect(markup).toContain("No verified full export contract");
    expect(markup).toContain("a full-field migration is not claimed here");

    // Person-to-person fallback.
    expect(markup).toContain("person to person");
    expect(markup).toContain("we’ll set up your watchlists with you");

    // Old overclaims are gone: no automatic collection/board or evidence transfer.
    expect(markup).not.toContain("Bring your saved work");
    expect(markup).not.toContain("Saved ad library and boards");
    expect(markup).not.toContain("save winning ads with notes and tags");
    expect(markup).not.toContain("set up your collections and watchlists");

    // No Slack GA claims or unverifiable channel claims.
    expect(markup).not.toContain("Evidence over vibes");
    expect(markup).not.toContain("No screenshots, no claim");
    expect(markup).not.toContain("Slack delivery");
    expect(markup).not.toContain("WhatsApp delivery");
  });

  it("declares the canonical URL and honest meta description", async () => {
    const { links, meta } = await import("~/routes/compare.magicbrief");

    expect(links()).toEqual([
      { rel: "canonical", href: "https://0509.io/compare/magicbrief" },
    ]);

    const tags = meta({} as never) as Array<Record<string, string>>;
    const title = tags.find((tag) => "title" in tag)?.title;
    expect(title).toBe("Five to Nine vs MagicBrief | Migration guide");

    const description = tags.find((tag) => tag.name === "description")?.content;
    expect(description).toContain("don't transfer");
    expect(description).toContain("person-to-person");
    expect(description).not.toContain("migrate your collections");
  });
});
