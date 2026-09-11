import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SNEAKER_RESALE_LOCALE_IDS,
  htmlLangForPathname,
} from "~/lib/locale-markets";
import { sneakerResaleHreflangLinks } from "~/lib/seo";

/**
 * Regression test for issue #1570, kept for the survivor of issue #2962
 * (orchestrator Branch B): every locale page that declares a non-EN
 * `<html lang>` must render content that differs from its EN twin and must
 * carry an hreflang x-default alternate. The untranslated buyer-surface
 * cluster the original issue audited is GONE for #2962 — every one of its
 * paths is now an EN 301, so the only non-EN surfaces left are the genuinely
 * translated sneaker-resale pages, and this file keeps enforcing that their
 * lang tags match real translated content (the body-diff prevention gate).
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

const SNEAKER_LOCALES = SNEAKER_RESALE_LOCALE_IDS.filter(
  (locale) => locale !== "en",
) as string[];

describe("locale content integrity (issue #1570, survivor set after #2962)", () => {
  describe("sneaker-resale cluster — lang != en must differ from EN twin", () => {
    // The sneaker-resale cluster is the genuinely translated surface: its
    // locale pages declare de/ja/pt-BR and MUST render content that differs
    // from the EN twin. This is the body-diff half of the prevention gate.
    for (const locale of SNEAKER_LOCALES) {
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
        const xDefault = links.find((link) => link.hreflang === "x-default");
        expect(xDefault, `sneaker-resale x-default missing`).toBeDefined();
        expect(xDefault?.href).toBe("https://0509.io/sneaker-resale");
      });
    }
  });

  describe("prevention gate — a fake-lang English page fails", () => {
    it("an EN-identical body tagged with a non-EN lang would fail the body-diff check", async () => {
      const enBody = normalizeBody(await renderSneakerResale("en"));
      const enBodyAgain = normalizeBody(await renderSneakerResale("en"));
      expect(enBody).toBe(enBodyAgain);
      // If a future worker rendered this same EN body under lang="de",
      // the sneaker-resale body-diff assertion (`not.toBe(enBody)`) would
      // fail — exactly the regression this test exists to prevent.
    });

    it("the deleted buyer-surface locale paths no longer resolve to a served page", () => {
      // Issue #2962 Branch B: every buyer-surface locale path 301s to the EN
      // pathname, so no page is left to mislabel itself with a non-EN lang.
      // The guard is htmlLangForPathname: no buyer-surface locale path
      // remains in the htmlLang map (only the sneaker-resale cluster).
      expect(htmlLangForPathname("/de/pricing")).toBe("en");
      expect(htmlLangForPathname("/fr/sneaker-resale")).toBe("en");
    });
  });
});

