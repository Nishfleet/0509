import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, isRouteErrorResponse } from "react-router";
import { describe, expect, it } from "vitest";

import { ErrorPage, errorPageAction, errorPageContent, readSignedIn } from "../app/components/error-page";

const LEAK = "postgres://user:hunter2@internal";

function markup(error: unknown, pathname: string, signedIn: boolean) {
  const content = errorPageContent(error, pathname);
  const action = errorPageAction(signedIn);
  return renderToStaticMarkup(
    createElement(ErrorPage, {
      title: content.title,
      detail: content.detail,
      actionHref: action.href,
      actionLabel: action.label,
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
    expect(isRouteErrorResponse(error)).toBe(true);
    const html = markup(error, "/this-page-is-not-here", false);
    expect(html).toContain("This page is not here");
    expect(html).toContain("Nothing in the product lives at /this-page-is-not-here.");
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to the landing");
    expect(html).not.toContain(LEAK);
    expect(html).not.toContain("404");
    expect(html).not.toContain("!");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("offers home when the loader says the visitor is signed in", () => {
    const error = { status: 404, statusText: "Not Found", internal: true, data: "" };
    const html = markup(error, "/missing", true);
    expect(html).toContain('href="/app"');
    expect(html).toContain("Back to home");
    expect(html).not.toContain('href="/"');
    expect(readSignedIn({ signedIn: true })).toBe(true);
    expect(readSignedIn({ signedIn: false })).toBe(false);
    expect(readSignedIn(undefined)).toBe(false);
  });

  it("renders a thrown-error route as the problem page and hides the upstream message", async () => {
    const routes = [
      {
        id: "root",
        path: "/",
        loader() {
          return { signedIn: false };
        },
        children: [
          {
            id: "blow-up",
            path: "blow-up",
            loader() {
              throw new Error(LEAK);
            },
            Component() {
              return null;
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
    const html = markup(error, "/blow-up", false);
    expect(html).toContain("The product hit a problem");
    expect(html).toContain("We have been told.");
    expect(html).not.toContain(LEAK);
    expect(html).not.toContain("blow-up");
    expect(html).toContain('href="/"');
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("treats a non-404 route error as the problem page", () => {
    const error = { status: 500, statusText: LEAK, internal: false, data: LEAK };
    const html = markup(error, "/app", false);
    expect(html).toContain("The product hit a problem");
    expect(html).not.toContain(LEAK);
    expect(errorPageAction(false).href).toBe("/");
  });
});
