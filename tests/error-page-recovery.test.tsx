import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UNSAFE_ErrorResponseImpl, createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ErrorBoundary, meta } from "~/root";
import {
  GONE_PAGE_TITLE,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
} from "~/lib/seo";
import NotFoundRoute from "~/routes/not-found";

/**
 * Issue #3617 — the 404/410 error page is the one surface on the site with no
 * path into the catalog and no signup CTA, and it is exactly where every
 * rotated-away brand URL lands (the /ads catalog rotates by design, #3496
 * measured 13 of 377 advertised URLs diverging in one week).
 *
 * The live 404 renders the root `ErrorBoundary`, not the matched catch-all:
 * React Router bubbles a thrown route error to the nearest boundary and slices
 * the active match set to it, so app/routes/not-found.tsx's own component and
 * `meta` never reach the response. That is why the live page shipped
 * `<title>Five to Nine</title>` while not-found.tsx declared a titled page.
 * Both renderers are asserted here so the two cannot drift apart again.
 *
 * The walker-style checks that only exercise happy paths never saw this, so
 * these assertions are the prevention mechanism the issue asked for.
 */

function routeError(status: number, data: unknown, statusText = "Not Found") {
  return new UNSAFE_ErrorResponseImpl(status, statusText, data);
}

function renderNotFoundRoute() {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: NotFoundRoute,
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

function renderBoundary(error: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(ErrorBoundary, { error }),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

type MetaEntry = { title?: string; name?: string; property?: string; content?: string };

function metaForError(status: number, data: unknown = null): MetaEntry[] {
  return (meta as unknown as (args: { error: unknown }) => MetaEntry[])({
    error: routeError(status, data),
  });
}

describe("error page recovery (issue #3617)", () => {
  it("renders a catalog link and the signup CTA on the matched not-found route", () => {
    const html = renderNotFoundRoute();

    expect(html).toContain("Page not found");
    // The catalog path back in, and the standard signup CTA.
    expect(html).toMatch(/<a[^>]+href="\/brands"[^>]*>/);
    expect(html).toMatch(/<a[^>]+href="\/auth\/signup\?source=error-page"[^>]*>/);
    // The dead ends the issue reported must be gone: "/" and a bare
    // unparameterised "/search" were the only two exits.
    expect(html).not.toMatch(/<a[^>]+href="\/"[^>]*>/);
    expect(html).not.toMatch(/<a[^>]+href="\/search"[^>]*>/);
  });

  it("renders the same recovery on the thrown 404 the root ErrorBoundary catches", () => {
    const html = renderBoundary(routeError(404, "Not Found"));

    expect(html).toContain("Page not found");
    expect(html).toMatch(/<a[^>]+href="\/brands"[^>]*>/);
    expect(html).toMatch(/<a[^>]+href="\/auth\/signup\?source=error-page"[^>]*>/);
    // Never the generic server-fault copy for a plain 404.
    expect(html).not.toContain("Something broke on our side");
  });

  it("titles the 404 page and ships the marketing-page share meta", () => {
    const tags = metaForError(404);

    expect(tags.find((tag) => "title" in tag)?.title).toBe(NOT_FOUND_TITLE);    // The full og:/twitter: block the issue asked for, not a bare title.
    for (const property of [
      "og:title",
      "og:description",
      "og:url",
      "og:image",
      "og:image:type",
      "og:image:width",
      "og:image:height",
      "og:image:alt",
      "og:site_name",
      "og:type",
    ]) {
      expect(tags.some((tag) => "property" in tag && tag.property === property)).toBe(true);
    }
    for (const name of [
      "twitter:card",
      "twitter:title",
      "twitter:description",
      "twitter:image",
      "twitter:image:alt",
    ]) {
      expect(tags.some((tag) => "name" in tag && tag.name === name)).toBe(true);
    }
    expect(
      tags.some(
        (tag) =>
          "name" in tag &&
          tag.name === "description" &&
          tag.content === NOT_FOUND_DESCRIPTION,
      ),
    ).toBe(true);
  });

  it("keeps the branded recovery row on a 410 while the brand pair comes first", () => {
    const html = renderBoundary(
      routeError(410, { domain: "nike.com", brandName: "Nike" }, "Gone"),
    );

    expect(html).toContain("This page is gone");
    // The visitor's own intent survives: the brand-specific pair is intact.
    expect(html).toMatch(/<a[^>]+href="\/search\?q=nike\.com"[^>]*>/);
    expect(html).toMatch(/<a[^>]+href="\/ads\/nike\.com"[^>]*>/);
    // ...and the page no longer dead-ends after those two.
    expect(html).toMatch(/<a[^>]+href="\/brands"[^>]*>/);
    expect(html).toMatch(/<a[^>]+href="\/auth\/signup\?source=error-page"[^>]*>/);
    expect(metaForError(410).find((tag) => "title" in tag)?.title).toBe(GONE_PAGE_TITLE);
  });

  it("registers the error-page signup marker on the allowlist", async () => {
    const { ALLOWED_SIGNUP_SOURCES, allowlistedSignupSource } = await import(
      "~/lib/signup-source"
    );

    expect(ALLOWED_SIGNUP_SOURCES).toContain("error-page");
    expect(allowlistedSignupSource("error-page")).toBe("error-page");
  });

  it("leaves the non-error title and meta untouched", () => {
    expect(meta({ data: undefined })).toEqual([{ title: "Five to Nine" }]);
  });
});
