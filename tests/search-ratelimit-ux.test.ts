import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoaderFunctionArgs } from "react-router";

import {
  PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
  PUBLIC_SEARCH_SELECTION_RATE_LIMIT_MESSAGE,
} from "~/lib/customer-route-error";

/**
 * Budget-exhausted /search UX regression gate (issue #2047).
 *
 * The anonymous per-browser budget and limits shipped in #1972 and must NOT
 * change here. This file pins the PRESENTATION of the exhausted state: a
 * fresh first-time visitor whose budget is gone must receive a labeled,
 * humane 429 document rendered by the route's ErrorBoundary — never a bare
 * 429 body and never the generic "Search hit a snag" catch-all.
 *
 * Two links in the chain are gated:
 *  1. the loader's budget-exhausted throw (labeled JSON body, Retry-After,
 *     signup continue path),
 *  2. the ErrorBoundary routing that thrown 429 onto the rate-limit surface.
 */

function createContext(env = {}) {
  return { cloudflare: { env } };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/workspace.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/ad-source.server");
  vi.doUnmock("~/lib/search-execution.server");
  vi.doUnmock("~/lib/search-selection.server");
  vi.doUnmock("react-router");
  vi.doUnmock("~/components/dashboard-shell");
});

async function mockAnonLoaderDeps(env: unknown, limiter: unknown) {
  vi.doMock("~/lib/auth.server", () => ({
    getOptionalSession: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/workspace.server", () => ({
    resolveWorkspace: vi.fn(async (_e: unknown, id: string) => ({
      workspaceUserId: id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({ getEnv: vi.fn(() => env) }));
  vi.doMock("~/lib/data.server", () => ({ listCollections: vi.fn() }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforcePublicSearchRateLimit: vi.fn().mockResolvedValue(limiter),
    enforcePublicSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
    enforceAuthenticatedSearchRateLimit: vi.fn().mockResolvedValue(null),
    enforceSearchSelectionRateLimit: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("~/lib/ad-source.server", () => ({
    searchAdsViaSourceResolver: vi.fn(),
  }));
  vi.doMock("~/lib/search-execution.server", () => ({
    executeSearchWithRelevance: vi.fn(),
    hasWarmSearchCacheEntry: vi.fn().mockResolvedValue(false),
    attachKeywordSearchDomainMatch: vi.fn(),
  }));
  vi.doMock("~/lib/search-selection.server", () => ({
    prepareSearchResultSelection: vi.fn(),
  }));
}

describe("budget-exhausted anonymous /search (issue #2047)", () => {
  it("the loader's exhausted-budget throw is a labeled 429 document, not a bare 429", async () => {
    const env = { DB: {} };
    // What the real limiter returns when the budget is gone.
    const budgetExhausted = new Response(
      JSON.stringify({ error: "rate_limited" }),
      {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "600",
        },
      },
    );
    await mockAnonLoaderDeps(env, budgetExhausted);

    const { loader } = await import("~/routes/search");
    const thrown = await loader({
      context: createContext(env),
      request: new Request("http://localhost/search?q=nike&country=all"),
    } as LoaderFunctionArgs).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(429);

    // Recovery signal survives onto the document response (the headers()
    // export forwards it) so the client knows when the window clears.
    expect(response.headers.get("retry-after")).toBe("600");

    // NOT a bare 429: the body names the limit, the retry window and a
    // working next action.
    const body = (await response.json()) as {
      error?: string;
      message?: string;
      retryAfter?: number;
      continuePath?: string;
    };
    expect(body.error).toBe("rate_limited");
    expect(body.message).toBe(PUBLIC_SEARCH_RATE_LIMIT_MESSAGE);
    expect(body.retryAfter).toBe(600);
    expect(body.continuePath).toMatch(/^\/auth\/signup\?redirectTo=/);
    expect(decodeURIComponent(body.continuePath ?? "")).toContain("/search?q=nike");
  });

  it("the route ErrorBoundary renders the humane rate-limit page for that 429, never the generic error", async () => {
    // Shape React Router hands the route ErrorBoundary for a thrown Response.
    const thrown429 = {
      status: 429,
      statusText: "Too Many Requests",
      data: {
        error: "rate_limited",
        message: PUBLIC_SEARCH_RATE_LIMIT_MESSAGE,
        retryAfter: 600,
        continuePath: "/auth/signup?redirectTo=%2Fsearch%3Fq%3Dnike%26country%3Dall",
      },
    };

    const React = await import("react");
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      return {
        ...actual,
        useLocation: () => ({
          pathname: "/search",
          search: "?q=nike&country=all",
        }),
        Link: ({
          children,
          to,
          ...props
        }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) =>
          React.createElement(
            "a",
            { ...props, href: typeof to === "string" ? to : "" },
            children,
          ),
        useRevalidator: () => ({
          state: "idle" as const,
          revalidate: () => {},
        }),
      };
    });
    vi.doMock("~/components/dashboard-shell", () => ({
      DashboardShell: ({ children }: { children: React.ReactNode }) =>
        React.createElement("main", null, children),
    }));

    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ErrorBoundary } = await import("~/routes/search");

    const html = renderToStaticMarkup(
      createElement(ErrorBoundary, { error: thrown429 }),
    );

    // Humane copy: named limit with the retry window, not the generic
    // "Search hit a snag" catch-all and not a bare JSON 429 blob.
    expect(html).toMatch(/You.{0,10}ve hit the anonymous search limit/);
    expect(html).toMatch(/20 searches per 10 minutes/);
    expect(html).not.toContain("Search hit a snag");
    expect(html).not.toMatch(/^\s*\{\s*"error"/);
    expect(html).toMatch(/Try again at/i);
    expect(html).toMatch(/\d{2}:\d{2} remaining/);

    // Working next actions: retry preserves the original q/country…
    expect(html).toMatch(/name="q"[^>]*value="nike"/);
    expect(html).toMatch(/name="country"[^>]*value="all"/);
    expect(html).toMatch(/data-retry-url="\/search\?q=nike&amp;country=all"/);
    // …and the free-account continue path stays on the funnel.
    expect(html).toMatch(/data-testid="rate-limit-continue"/);
    expect(html).toMatch(/Continue in a signed-in account \(free\)/);
    expect(html).toMatch(/auth\/signup\?redirectTo=/);
    expect(html).toMatch(/auth\/login\?redirectTo=/);

    // Sanity (inverse gate): a NON-rate-limit thrown error must not satisfy
    // the rate-limit branch — the ErrorBoundary dispatch is status-specific,
    // so a plain 500 keeps the generic server-error copy.
    const thrown500 = { status: 500, statusText: "Internal Server Error" };
    const genericHtml = renderToStaticMarkup(
      createElement(ErrorBoundary, { error: thrown500 }),
    );
    expect(genericHtml).not.toMatch(/search limit/i);
    expect(genericHtml).not.toMatch(/Try again at/i);

    vi.doUnmock("react-router");
    vi.doUnmock("~/components/dashboard-shell");
  });

  it("keeps the two anonymous budget messages distinct so each window speaks for itself", () => {
    // Presentation-only guard: the search budget and the ad-check budget
    // exhausted states speak in their own voices so the visitor knows which
    // window is clearing.
    expect(PUBLIC_SEARCH_RATE_LIMIT_MESSAGE).toMatch(/search limit/i);
    expect(PUBLIC_SEARCH_SELECTION_RATE_LIMIT_MESSAGE).toMatch(/ad-check limit/i);
    expect(PUBLIC_SEARCH_RATE_LIMIT_MESSAGE).not.toBe(
      PUBLIC_SEARCH_SELECTION_RATE_LIMIT_MESSAGE,
    );
  });
});
