import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { ErrorBoundary } from "~/root";

function makeRouteError(status: number, data: unknown, statusText = "Gone") {
  return {
    status,
    statusText,
    data,
    internal: false,
  };
}

function renderErrorPage(error: ReturnType<typeof makeRouteError>) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(ErrorBoundary, { error }),
    },
  ]);

  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

describe("root ErrorBoundary HTTP 410", () => {
  it("renders an honest Gone page with no server-fault language for an unadorned 410", () => {
    const html = renderErrorPage(makeRouteError(410, "Gone"));

    expect(html).not.toContain("Something broke on our side");
    expect(html).toMatch(/<h1[^>]*>.*(?:This page is gone|Not stored yet).*<\/h1>/i);
    expect(html).toMatch(/<a[^>]+href="\/"[^>]*>/);
    expect(html).toMatch(/<a[^>]+href="\/search"[^>]*>/);
  });

  it("names the brand and points at /search and /ads for a timeline 410", () => {
    const html = renderErrorPage(
      makeRouteError(410, { domain: "nike.com", brandName: "Nike" }),
    );

    expect(html).not.toContain("Something broke on our side");
    expect(html).toContain("nike.com");
    expect(html).toMatch(/<a[^>]+href="\/search\?q=nike\.com"[^>]*>/);
    expect(html).toMatch(/<a[^>]+href="\/ads\/nike\.com"[^>]*>/);
  });
});
