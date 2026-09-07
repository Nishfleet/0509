import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TrustRoute is purely static (no loader data), but it renders <Link> from
// react-router and may call loader hooks; mock react-router with a working
// <Link> and inert loader stubs so the route renders server-side.
beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => undefined,
      useRouteLoaderData: () => undefined,
      Link: ({ children, to, ...props }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
    };
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function renderTrustPage(): Promise<string> {
  const { default: TrustRoute } = await import("~/routes/trust");
  return renderToStaticMarkup(createElement(TrustRoute));
}

describe("/trust — Data handled claim (issue #1498, BET 10 / trust surface)", () => {
  it("does NOT list 'landing-page snapshots' as stored data", async () => {
    const markup = await renderTrustPage();

    // The "Data handled" block must no longer make the false stored-data claim.
    expect(markup).not.toContain("landing-page snapshots");
    // Positive anchor: the block itself must render, so the negative assertion
    // above cannot pass vacuously if the "Data handled" section silently
    // disappears. (reviewer finding, 0509 #1498)
    expect(markup).toContain("service logs");
  });
});
