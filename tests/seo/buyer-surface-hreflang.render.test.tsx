import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

/**
 * Issue #2030 accept #4: the canonical English page and its locale variant
 * must each carry the reciprocal hreflang `<link>` tags in their rendered
 * `<head>`. The canonical EN side is emitted by the root Layout's
 * `BuyerSurfaceHreflang` (from the current pathname); the locale side comes
 * from the locale route's own `links`. This renders the real root Layout
 * (with react-router stubbed) and asserts the tags are present.
 */

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      Links: () => null,
      Meta: () => null,
      Outlet: () => null,
      Scripts: () => null,
      ScrollRestoration: () => null,
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("rendered hreflang on a canonical page and its locale variant (issue #2030)", () => {
  it("renders the reciprocal hreflang cluster in the canonical home page <head>", async () => {
    const React = await import("react");
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const ReactInner = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: MockLinkProps) =>
          ReactInner.createElement(
            "a",
            { ...props, href: typeof to === "string" ? to : "" },
            children,
          ),
        Links: () => null,
        Meta: () => null,
        Outlet: () => null,
        Scripts: () => null,
        ScrollRestoration: () => null,
        useLocation: () => ({ pathname: "/" }),
        useRouteLoaderData: () => undefined,
      };
    });
    const { Layout } = await import("~/root");
    const html = renderToStaticMarkup(createElement(Layout, { children: null }));
    // The canonical home page declares every sibling locale + x-default.
    expect(html).toContain(`<link rel="alternate" hreflang="de" href="https://0509.io/de"/>`);
    expect(html).toContain(`<link rel="alternate" hreflang="ja" href="https://0509.io/ja"/>`);
    expect(html).toContain(`<link rel="alternate" hreflang="pt-br" href="https://0509.io/pt-br"/>`);
    expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="https://0509.io/"/>`);
  });

  it("renders no duplicate hreflang on a locale-prefixed page (its route emits it)", async () => {
    const React = await import("react");
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const ReactInner = await import("react");
      return {
        ...actual,
        Link: ({ children, to, ...props }: MockLinkProps) =>
          ReactInner.createElement(
            "a",
            { ...props, href: typeof to === "string" ? to : "" },
            children,
          ),
        Links: () => null,
        Meta: () => null,
        Outlet: () => null,
        Scripts: () => null,
        ScrollRestoration: () => null,
        useLocation: () => ({ pathname: "/de/pricing" }),
        useRouteLoaderData: () => undefined,
      };
    });
    const { Layout } = await import("~/root");
    const html = renderToStaticMarkup(createElement(Layout, { children: null }));
    // The root Layout must NOT re-emit hreflang on a locale page — the locale
    // route's own links handle it, so the head never gets a duplicate set.
    expect(html).not.toContain(`rel="alternate" hreflang="de"`);
  });
});