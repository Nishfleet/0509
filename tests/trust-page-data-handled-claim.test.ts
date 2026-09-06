import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("trust page data-handled claim", () => {
  it("omits landing-page snapshots from the stored-category enumeration (issue 1498)", async () => {
    const { default: TrustRoute } = await import("~/routes/trust");
    const markup = renderToStaticMarkup(createElement(TrustRoute));

    // The data-handled block must not list landing-page snapshots as a stored
    // category: the table has 0 rows in production and the timeline route is
    // not live. Cover both hyphenated and spaced phrasings, case-insensitively.
    expect(markup).not.toMatch(/landing[- ]page snapshots/i);

    // The rest of the data-handled enumeration must still render, so a future
    // edit that deletes the whole block instead of just the phrase fails here.
    expect(markup).toContain("account records");
    expect(markup).toContain("proof-backed changes");
    expect(markup).toContain("service logs");
  });
});
