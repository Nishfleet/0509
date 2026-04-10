import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import routes from "~/routes";

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

function flattenRoutePaths(entries: Array<{ path?: string; children?: unknown[] }>): string[] {
  return entries.flatMap((entry) => [
    entry.path,
    ...flattenRoutePaths((entry.children as Array<{ path?: string; children?: unknown[] }> | undefined) ?? []),
  ].filter((value): value is string => Boolean(value)));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    onboardedAt: "2026-04-02 18:30:00",
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-04-03T00:00:00.000Z",
  },
};

describe("billing route exposure", () => {
  it("does not expose checkout or Stripe webhook endpoints", () => {
    const paths = flattenRoutePaths(routes as Array<{ path?: string; children?: unknown[] }>);

    expect(paths).not.toContain("api/checkout");
    expect(paths).not.toContain("api/webhooks/stripe");
  });
});

describe("app layout loader", () => {
  it("returns only session data for workspace chrome", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue("free"),
    }));

    const { loader } = await import("~/routes/app-layout");
    const result = await loader({
      context: createContext(),
      request: new Request("http://localhost/app"),
    } as never);

    expect(result).toEqual({
      session,
    });
  });
});

describe("marketing route", () => {
  it("does not render purchase forms for signed-in users", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) =>
          React.createElement("form", props, children as ReactNode),
        Link: ({ children, to, ...props }: Record<string, unknown> & { children?: ReactNode; to?: string }) =>
          React.createElement("a", { ...props, href: to }, children as ReactNode),
        useRouteLoaderData: vi.fn().mockReturnValue({
          pricingPlans: [
            {
              name: "Starter",
              monthlyLabel: "Rs 2,500 / month",
              yearlyLabel: "Rs 24,000 / year",
              detail: "Solo or small team.",
            },
          ],
          pricingRegion: "india",
          session,
        }),
      };
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).not.toContain("/api/checkout");
    expect(markup).not.toContain("Upgrade to Starter");
    expect(markup).toContain("Open workspace");
  });
});
