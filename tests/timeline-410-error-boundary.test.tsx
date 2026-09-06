/**
 * Regression test for issue #1779 (/timeline/:domain 410 renders the generic
 * "Something went wrong" error boundary instead of the honest Gone shell).
 *
 * The 410 is thrown by the real timeline route loader when a stored-snapshot
 * read succeeds with zero rows (retire path, #1309). This test drives that
 * real loader end-to-end and renders the thrown 410 through the real root
 * ErrorBoundary, asserting the honest Gone copy surfaces and the generic
 * server-fault language does not.
 *
 * It mirrors the loader-dependency mocking in tests/offer-timeline.route.test.ts
 * but goes one step further: it renders the loader's 410 through the error
 * boundary, so a future change that (a) stops throwing a data-bearing 410 or
 * (b) regresses the Gone shell is caught here.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UNSAFE_ErrorResponseImpl, createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "~/root";

function createContext(env: Record<string, unknown>) {
  return {
    cloudflare: {
      env,
    },
  };
}

function installLoaderMocks() {
  const env = { DB: {} };

  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => env),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicBrandPageRateLimit: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/offer-timeline.server", () => ({
    loadOfferTimeline: vi.fn().mockResolvedValue({ entries: [], asOfState: null }),
    isOfferTimelineShareEnabled: () => true,
  }));
}

/**
 * Run the real loader and return the route error React Router would pass to
 * the ErrorBoundary: the thrown 410 Response's status/text plus its JSON body.
 */
async function timeline410RouteError(): Promise<unknown> {
  installLoaderMocks();
  const { loader } = await import("~/routes/timeline.$domain");
  try {
    await loader({
      context: createContext({ DB: {} }),
      params: { domain: "nike.com" },
      request: new Request("https://0509.io/timeline/nike.com"),
    } as never);
  } catch (thrown) {
    const response = thrown as Response;
    return new UNSAFE_ErrorResponseImpl(
      response.status,
      response.statusText,
      await response.json(),
    );
  }
  throw new Error("timeline loader unexpectedly resolved instead of throwing a 410");
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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/offer-timeline.server");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/timeline/:domain 410 error boundary (issue #1779)", () => {
  it("renders the honest Gone shell, not the generic 'Something went wrong'", async () => {
    // Drive the real loader: a zero-row snapshot read throws a data-bearing
    // 410 Gone Response (retire path, #1309).
    const error = await timeline410RouteError();
    expect(error).toBeDefined();

    const html = renderBoundary(error);

    // The generic server-fault language this issue reported must never appear.
    expect(html).not.toContain("Something went wrong");
    expect(html).not.toContain("Something broke");

    // The honest Gone shell surfaces, naming the brand and its actions.
    expect(html).toMatch(/<h1[^>]*>This page is gone<\/h1>/);
    expect(html).toContain("We have no stored offer timeline for Nike yet.");
    expect(html).toMatch(/<a[^>]+href="\/search\?q=nike\.com"[^>]*>/);
    expect(html).toMatch(/<a[^>]+href="\/ads\/nike\.com"[^>]*>/);
  });
});
