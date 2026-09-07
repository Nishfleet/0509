import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkDescriptor } from "react-router";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

const GOOGLE_FONTS_HOST = "https://fonts.googleapis.com";

function htmlDescriptors(descriptors: LinkDescriptor[]) {
  return descriptors.filter(
    (descriptor): descriptor is Extract<LinkDescriptor, { href?: string }> =>
      typeof descriptor === "object" && descriptor !== null && "href" in descriptor,
  );
}

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
      useLocation: () => ({ pathname: "/" }),
      useRouteLoaderData: () => undefined,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Google Fonts stylesheet loading (dogfood da0f9f345221)", () => {
  it("keeps the font preconnects but drops the render-blocking stylesheet from links()", async () => {
    const { links, GOOGLE_FONTS_STYLESHEET_HREF } = await import("~/root");
    const descriptors = htmlDescriptors(links());

    const preconnects = descriptors.filter((descriptor) => descriptor.rel === "preconnect");
    expect(preconnects.map((descriptor) => descriptor.href)).toEqual(
      expect.arrayContaining([
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
      ]),
    );

    const stylesheets = descriptors.filter((descriptor) => descriptor.rel === "stylesheet");
    expect(stylesheets).toEqual([]);
    expect(descriptors.some((descriptor) => descriptor.href?.includes(GOOGLE_FONTS_STYLESHEET_HREF))).toBe(
      false,
    );
  });

  it("preloads the font sheet, applies it after load, and keeps a no-JS fallback", async () => {
    const {
      default: RootApp,
      GOOGLE_FONTS_STYLESHEET_HREF,
      FONT_SWAP_SCRIPT,
      GoogleFontsStylesheet,
    } = await import("~/root");
    void RootApp;
    // React HTML-escapes the & in the css2 URL when serializing attributes.
    const href = GOOGLE_FONTS_STYLESHEET_HREF.replace(/&/g, "&amp;");
    const markup = renderToStaticMarkup(createElement(GoogleFontsStylesheet));

    // High-priority preload so the sheet still fetches early.
    expect(markup).toContain(`<link rel="preload" as="style" href="${href}"/>`);
    // Loaded print-only (non-render-blocking), then swapped to all on load
    // (and immediately when the sheet is already cached).
    expect(markup).toContain(
      `<link id="f9-font-stylesheet" rel="stylesheet" href="${href}" media="print"/>`,
    );
    expect(FONT_SWAP_SCRIPT).toContain('l.addEventListener("load",apply)');
    expect(FONT_SWAP_SCRIPT).toContain("if(l.sheet){apply();}");
    // The stylesheet link must suppress hydration warnings: FONT_SWAP_SCRIPT
    // can flip media before React hydrates when css2 is cached.
    const tree = GoogleFontsStylesheet();
    const stylesheetLink = (tree.props.children as ReactNode[]).find(
      (child) =>
        child !== null &&
        typeof child === "object" &&
        "props" in child &&
        (child as { props: { id?: string } }).props.id === "f9-font-stylesheet",
    ) as { props: { suppressHydrationWarning?: boolean } } | undefined;
    expect(stylesheetLink?.props.suppressHydrationWarning).toBe(true);
    // JS-off fallback still applies the sheet as a normal stylesheet.
    expect(markup).toContain(`<noscript><link rel="stylesheet" href="${href}"/></noscript>`);
  });

  it("wires the non-blocking font sheet into the rendered Layout head", async () => {
    const { Layout, GOOGLE_FONTS_STYLESHEET_HREF } = await import("~/root");
    const href = GOOGLE_FONTS_STYLESHEET_HREF.replace(/&/g, "&amp;");
    const markup = renderToStaticMarkup(
      createElement(Layout, null, createElement("main", null, "content")),
    );

    const head = markup.slice(markup.indexOf("<head>"), markup.indexOf("</head>"));
    expect(head).toContain(`<link rel="preload" as="style" href="${href}"/>`);
    expect(head).toContain(
      `<link id="f9-font-stylesheet" rel="stylesheet" href="${href}" media="print"/>`,
    );
    expect(head).toContain('l.addEventListener("load",apply)');
    expect(head).toContain("if(l.sheet){apply();}");
    expect(head).toContain(`<noscript><link rel="stylesheet" href="${href}"/></noscript>`);

    // No render-blocking googleapis stylesheet remains anywhere in the head
    // (the <noscript> fallback may stay a plain stylesheet: it only applies
    // when scripts are off, so it can never delay first paint).
    const fontLinks =
      head.match(/(?:<noscript>)?<link[^>]*href="https:\/\/fonts\.googleapis\.com[^>]*>/g) ??
      [];
    expect(fontLinks.length).toBeGreaterThan(0);
    for (const link of fontLinks) {
      if (link.startsWith("<noscript>")) continue;
      expect(link, "every googleapis link must be a preload, preconnect, or print-media sheet").toMatch(
        /rel="(?:preload|preconnect|stylesheet)"/,
      );
      if (link.includes('rel="stylesheet"')) {
        expect(link, "no render-blocking font stylesheet may remain").toContain('media="print"');
      }
    }
  });
});
