/**
 * Regression test for issue #1930: a rate-limited /ads/:domain or
 * /timeline/:domain request must render the honest per-IP free-preview limit
 * state with a recovery path and forward Retry-After — never the generic
 * "Something broke on our side" root error boundary.
 *
 * The 429 is thrown by the real route loaders when the anonymous brand-page
 * limiter trips (enforcePublicBrandPageRateLimit). This test drives each real
 * loader end-to-end with the limiter mocked to return a 429, then renders the
 * thrown 429 through the route's own ErrorBoundary, asserting the honest copy
 * surfaces, Retry-After is forwarded, and the generic server-fault language
 * does not.
 *
 * It mirrors the loader-dependency mocking in tests/timeline-410-error-boundary
 * .test.tsx but goes one step further: it asserts the route-level headers()
 * export forwards Retry-After onto the final document response, so a future
 * change that (a) stops throwing a data-bearing 429, (b) regresses the honest
 * shell, or (c) drops the Retry-After forwarding is caught here.
 */

import { createElement } from "react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UNSAFE_ErrorResponseImpl, createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env: Record<string, unknown>) {
  return {
    cloudflare: {
      env,
    },
  };
}

/** A 429 Response shaped exactly like the real limiter's tooManyRequestsResponse. */
function rateLimitResponse(retryAfterSeconds = 600) {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Too many requests. Please try again shortly.",
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(retryAfterSeconds),
        "cache-control": "no-store",
      },
    },
  );
}

function installLoaderMocks() {
  const env = { DB: {} };

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(rateLimitResponse()),
  }));
}

/**
 * Run the real loader and return the route error React Router would pass to
 * the ErrorBoundary: the thrown 429 Response's status/text plus its JSON body.
 */
async function routeError(route: "ads" | "timeline"): Promise<unknown> {
  const { loader } =
    route === "ads"
      ? await import("~/routes/ads.$domain")
      : await import("~/routes/timeline.$domain");
  const path = route === "ads" ? "/ads/nike.com" : "/timeline/nike.com";
  try {
    await loader({
      context: createContext({ DB: {} }),
      params: { domain: "nike.com" },
      request: new Request(`https://0509.io${path}`),
    } as never);
  } catch (thrown) {
    const response = thrown as Response;
    return new UNSAFE_ErrorResponseImpl(
      response.status,
      response.statusText,
      await response.json(),
    );
  }
  throw new Error(`${route} loader unexpectedly resolved instead of throwing a 429`);
}

function renderBoundary(ErrorBoundary: ComponentType<{ error: unknown }>, error: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(ErrorBoundary, { error }),
    },
  ]);
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/"] }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/ads/:domain and /timeline/:domain rate-limit error boundary (issue #1930)", () => {
  it.each(["ads", "timeline"] as const)(
    "%s renders the honest rate-limit state, not the generic shell",
    async (route) => {
      installLoaderMocks();
      const error = await routeError(route);
      expect(error).toBeDefined();

      // Grab the route's own ErrorBoundary from the same (mocked) module
      // instance the loader came from, so the boundary and loader agree.
      const { ErrorBoundary } =
        route === "ads"
          ? await import("~/routes/ads.$domain")
          : await import("~/routes/timeline.$domain");

      const html = renderBoundary(ErrorBoundary, error);

      // The generic server-fault language this issue reported must never appear.
      expect(html).not.toContain("Something went wrong");
      expect(html).not.toContain("Something broke");

      // The honest per-IP free-preview limit copy surfaces, naming the limit
      // and the recovery path.
      expect(html).toMatch(/<h2[^>]*>Too many requests<\/h2>/);
      expect(html).toContain("anonymous preview limit");
      expect(html).toContain("120 page loads per 10 minutes");
      expect(html).toContain("wait a few minutes and try again");
      // A recovery path is offered.
      expect(html).toMatch(/<a[^>]+href="\/"[^>]*>/);
    },
  );

  it.each(["ads", "timeline"] as const)(
    "%s headers() forwards Retry-After from the thrown 429",
    async (route) => {
      installLoaderMocks();
      const { headers } =
        route === "ads"
          ? await import("~/routes/ads.$domain")
          : await import("~/routes/timeline.$domain");
      const errorHeaders = new Headers({ "retry-after": "600" });
      const documentHeaders = headers({ errorHeaders } as never) as Record<string, string>;
      expect(documentHeaders["Retry-After"]).toBe("600");
    },
  );

  it.each(["ads", "timeline"] as const)(
    "%s headers() adds nothing when there is no error",
    async (route) => {
      installLoaderMocks();
      const { headers } =
        route === "ads"
          ? await import("~/routes/ads.$domain")
          : await import("~/routes/timeline.$domain");
      const documentHeaders = headers({ errorHeaders: undefined } as never) as Record<string, string>;
      expect(documentHeaders).toEqual({});
    },
  );
});
