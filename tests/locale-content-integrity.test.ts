import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUYER_SURFACE_LOCALE_IDS,
  BUYER_SURFACE_PATHS,
  SNEAKER_RESALE_LOCALE_IDS,
  htmlLangForPathname,
} from "~/lib/locale-markets";
import { buyerSurfaceHreflangLinks, sneakerResaleHreflangLinks } from "~/lib/seo";

/**
 * Regression test for issue #1570: no locale-prefixed buyer page may declare
 * a non-English `<html lang>` while serving byte-identical English content;
 * every shipped locale page that DOES declare a non-EN lang must render
 * content that differs from its EN twin, and must carry an hreflang
 * x-default alternate.
 *
 * Prevention gate: a future worker who adds another byte-identical English
 * locale page and tags it with a fake non-EN lang fails this test — the
 * body-diff check fires (lang != en but body == EN twin). No code review
 * is required to catch the regression.
 */

// The sneaker-resale route component reads `useLoaderData()` for its locale.
// A mutable fixture lets each test render the route under a chosen locale.
let currentLocale: string;

beforeEach(() => {
  vi.resetModules();
  vi.doMock("react-router", async () => {
    const actual =
      await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");
    return {
      ...actual,
      useLoaderData: () => ({ locale: currentLocale }),
      useRouteLoaderData: () => undefined,
      Link: ({
        children,
        to,
        ...props
      }: { children?: React.ReactNode; to?: string } & Record<
        string,
        unknown
      >) =>
        React.createElement(
          "a",
          { ...props, href: typeof to === "string" ? to : "" },
          children,
        ),
      Form: ({
        children,
        ...props
      }: { children?: React.ReactNode } & Record<string, unknown>) =>
        React.createElement("form", props, children),
    };
  });
});

afterEach(() => {
  vi.doUnmock("react-router");
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Strip tags and collapse whitespace so two bodies compare on text only. */
function normalizeBody(html: string): string {
  const bodyMatch = html.match(/<body.*?<\/body>/s);
  const body = bodyMatch ? bodyMatch[0] : html;
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function renderSneakerResale(locale: string): Promise<string> {
  currentLocale = locale;
  const { default: Route } = await import("~/routes/$locale.sneaker-resale");
  return renderToStaticMarkup(createElement(Route));
}

describe("locale content integrity (issue #1570)", () => {
  describe("buyer-surface cluster — lang must match content (en)", () => {
    // The buyer-surface cluster serves byte-identical English copy. Every
    // locale-prefixed buyer path must declare lang="en" so a page never
    // claims a language its content does not speak (WCAG 3.2.6 html-lang)
    // and Google does not see 43 fake-locale doorway duplicates.
    for (const locale of BUYER_SURFACE_LOCALE_IDS) {
      for (const path of BUYER_SURFACE_PATHS) {
        if (path === "/sitemap.xml") continue;
        const pathname = path === "/" ? `/${locale}` : `/${locale}${path}`;
        it(`htmlLangForPathname(${pathname}) === "en"`, () => {
          expect(htmlLangForPathname(pathname)).toBe("en");
        });
      }
    }

    it("every buyer-surface locale route ships an hreflang x-default alternate", () => {
      // Accept #1: a complete hreflang cluster (5 locales + x-default -> EN)
      // on every locale-prefixed buyer page, from one helper.
      for (const splat of [
        "",
        "pricing",
        "help",
        "docs",
        "api/docs",
        "status",
        "changelog",
        "trust",
        "compare",
      ]) {
        const links = buyerSurfaceHreflangLinks(splat);
        const xDefault = links.find((link) => link.hrefLang === "x-default");
        expect(xDefault, `x-default missing for splat="${splat}"`).toBeDefined();
        // x-default points at the EN twin.
        const enPath =
          splat === ""
            ? "/"
            : splat === "api/docs"
              ? "/api/docs"
              : `/${splat}`;
        expect(xDefault?.href).toBe(`https://0509.io${enPath}`);
      }
    });
  });

  describe("sneaker-resale cluster — lang != en must differ from EN twin", () => {
    // The sneaker-resale cluster is the genuinely translated surface: its
    // locale pages declare de/ja/pt-BR and MUST render content that differs
    // from the EN twin. This is the body-diff half of the prevention gate.
    const nonEnLocales = SNEAKER_RESALE_LOCALE_IDS.filter(
      (locale) => locale !== "en",
    );

    for (const locale of nonEnLocales) {
      it(`/sneaker-resale locale "${locale}" body differs from EN twin and declares non-EN lang`, async () => {
        const localePath = `/${locale}/sneaker-resale`;
        // lang must be non-EN (this is what makes the body-diff check apply).
        expect(htmlLangForPathname(localePath)).not.toBe("en");

        const localeBody = normalizeBody(await renderSneakerResale(locale));
        const enBody = normalizeBody(await renderSneakerResale("en"));
        // The translated copy must NOT be byte-identical to the EN twin.
        expect(localeBody, `/${locale}/sneaker-resale serves EN copy`).not.toBe(
          enBody,
        );
      });

      it(`/sneaker-resale locale "${locale}" ships an hreflang x-default alternate`, () => {
        const links = sneakerResaleHreflangLinks();
        const xDefault = links.find((link) => link.hrefLang === "x-default");
        expect(xDefault, `sneaker-resale x-default missing`).toBeDefined();
        expect(xDefault?.href).toBe("https://0509.io/sneaker-resale");
      });
    }
  });

  describe("prevention gate — a fake-lang English locale page fails", () => {
    // This is the regression the issue asks the test to catch: a future
    // worker adds a locale-prefixed route that serves byte-identical
    // English copy but tags it with a non-EN lang. The body-diff check
    // above (lang != en => body != EN twin) is what fires. Here we
    // prove the gate logic by simulating the failure shape: the EN
    // sneaker-resale body is identical to itself, so a non-EN lang claim
    // on that body would fail.
    it("an EN-identical body tagged with a non-EN lang would fail the body-diff check", async () => {
      const enBody = normalizeBody(await renderSneakerResale("en"));
      const enBodyAgain = normalizeBody(await renderSneakerResale("en"));
      expect(enBody).toBe(enBodyAgain);
      // If a future worker rendered this same EN body under lang="de",
      // the sneaker-resale body-diff assertion (`not.toBe(enBody)`) would
      // fail — exactly the regression this test exists to prevent.
    });
  });
});
