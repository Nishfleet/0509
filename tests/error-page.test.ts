import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, isRouteErrorResponse } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../app/lib/auth.server", () => ({
  hasSessionCookie: () => false,
}));

import { ErrorBoundary } from "../app/root";

const LEAK = "postgres://user:hunter2@internal";

function page(error: unknown, signedIn: boolean, pathname: string) {
  return renderToStaticMarkup(
    createElement(ErrorBoundary, {
      error,
      params: {},
      loaderData: { signedIn, pathname },
    }),
  );
}

describe("error page", () => {
  it("says what is missing and offers the landing when signed out", () => {
    const error = {
      status: 404,
      statusText: LEAK,
      internal: true,
      data: LEAK,
    };
    const html = page(error, false, "/this-page-is-not-here");
    expect(html).toContain("This page is not here");
    expect(html).toContain("Nothing in the product lives at /this-page-is-not-here.");
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to the landing");
    expect(html).toContain("rounded-none");
    expect(html).not.toContain(LEAK);
    expect(html).not.toContain("404");
    expect(html).not.toContain("!");
    expect(html).not.toContain("<pre");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("offers home when the loader says the visitor is signed in", () => {
    const error = { status: 404, statusText: "Not Found", internal: true, data: "" };
    const html = page(error, true, "/missing");
    expect(html).toContain('href="/app"');
    expect(html).toContain("Back to home");
    expect(html).not.toContain('href="/"');
  });

  it("renders a thrown-error route as the problem page and hides the upstream message", async () => {
    const routes = [
      {
        id: "root",
        path: "/",
        loader() {
          return { signedIn: false, pathname: "/blow-up" };
        },
        ErrorBoundary,
        children: [
          {
            id: "blow-up",
            path: "blow-up",
            loader() {
              throw new Error(LEAK);
            },
          },
        ],
      },
    ];
    const handler = createStaticHandler(routes);
    const context = await handler.query(new Request("http://0509.io/blow-up"));
    expect(context).not.toBeInstanceOf(Response);
    if (context instanceof Response) return;
    expect(context.statusCode).toBe(500);
    const error = context.errors?.root;
    expect(error).toBeInstanceOf(Error);
    const html = page(error, false, "/blow-up");
    expect(html).toContain("The product hit a problem");
    expect(html).toContain("We have been told.");
    expect(html).not.toContain(LEAK);
    expect(html).not.toContain("blow-up");
    expect(html).not.toContain("<pre");
    expect(html).toContain('href="/"');
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("treats a non-404 route error as the problem page", () => {
    const error = { status: 500, statusText: LEAK, internal: false, data: LEAK };
    const html = page(error, false, "/app");
    expect(html).toContain("The product hit a problem");
    expect(html).not.toContain(LEAK);
    expect(html).not.toContain("404");
  });

  it("lets the framework 404 an unknown path through the same boundary", async () => {
    const routes = [
      {
        id: "root",
        path: "/",
        loader({ request }: { request: Request }) {
          return { signedIn: true, pathname: new URL(request.url).pathname };
        },
        ErrorBoundary,
        children: [{ id: "index", index: true, Component: () => null }],
      },
    ];
    const handler = createStaticHandler(routes);
    const context = await handler.query(new Request("http://0509.io/this-page-is-not-here"));
    expect(context).not.toBeInstanceOf(Response);
    if (context instanceof Response) return;
    expect(context.statusCode).toBe(404);
    const error = context.errors?.root;
    expect(isRouteErrorResponse(error)).toBe(true);
    if (!isRouteErrorResponse(error)) return;
    expect(error.status).toBe(404);
    const html = page(error, true, "/this-page-is-not-here");
    expect(html).toContain("This page is not here");
    expect(html).toContain("Nothing in the product lives at /this-page-is-not-here.");
    expect(html).toContain('href="/app"');
    expect(html).toContain("Back to home");
    expect(html).not.toContain("Not Found");
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
