import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import routes from "~/routes";

type RouteEntry = { path?: string; children?: RouteEntry[] };
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function createContext() {
  return {
    cloudflare: {
      env: {},
    },
  };
}

function flattenRoutePaths(entries: RouteEntry[]): string[] {
  return entries.flatMap((entry) => [
    entry.path,
    ...flattenRoutePaths(entry.children ?? []),
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
  it("does not expose generic checkout or Stripe webhook endpoints", () => {
    const paths = flattenRoutePaths(routes as RouteEntry[]);

    expect(paths).not.toContain("api/checkout");
    expect(paths).not.toContain("api/webhooks/stripe");
  });

  it("exposes basic legal pages before self-serve launch", () => {
    const paths = flattenRoutePaths(routes as RouteEntry[]);

    expect(paths).toContain("privacy");
    expect(paths).toContain("terms");
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
      showOpsNav: false,
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
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useRouteLoaderData: vi.fn().mockReturnValue({
          pricingPlans: [
            {
              slug: "starter",
              name: "Starter",
              monthlyLabel: "Rs 2,500 / month",
              yearlyLabel: "Rs 24,000 / year",
              detail: "Solo or small team.",
            },
          ],
          pricingRegion: "india",
          razorpayCheckout: {
            starter: { monthly: false, yearly: false },
            agency: { monthly: false, yearly: false },
          },
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

  it("renders Razorpay subscription actions only when India checkout is configured", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useRouteLoaderData: vi.fn().mockReturnValue({
          pricingPlans: [
            {
              slug: "starter",
              name: "Starter",
              monthlyLabel: "Rs 2,500 / month",
              yearlyLabel: "Rs 24,000 / year",
              detail: "Solo or small team.",
            },
          ],
          pricingRegion: "india",
          razorpayCheckout: {
            starter: { monthly: true, yearly: true },
            agency: { monthly: false, yearly: false },
          },
          session,
        }),
      };
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).toContain("/api/billing/razorpay/subscription");
    expect(markup).toContain("Start monthly");
    expect(markup).toContain("Start yearly");
  });
});

describe("pricing region route", () => {
  it("redirects direct GET requests instead of throwing a route error", async () => {
    const { loader } = await import("~/routes/pricing-region");

    const response = await loader({
      context: createContext(),
      request: new Request("http://localhost/pricing-region?redirectTo=/search"),
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/search");
  });

  it("sanitizes invalid pricing region and redirect values", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      upsertPricingRegionPreference: vi.fn(),
    }));

    const formData = new FormData();
    formData.set("region", "invalid");
    formData.set("redirectTo", "https://evil.example");

    const { action } = await import("~/routes/pricing-region");
    const response = await action({
      context: createContext(),
      request: new Request("http://localhost/pricing-region", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("pricing_region=rest_of_world");
  });

  it("persists the selected region for signed-in users", async () => {
    const upsertPricingRegionPreference = vi.fn().mockResolvedValue(undefined);
    vi.doMock("~/lib/auth.server", () => ({
      getOptionalSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ DB: {} })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      upsertPricingRegionPreference,
    }));

    const formData = new FormData();
    formData.set("region", "india");
    formData.set("redirectTo", "/");

    const { action } = await import("~/routes/pricing-region");
    const response = await action({
      context: createContext(),
      request: new Request("http://localhost/pricing-region", {
        method: "POST",
        body: formData,
      }),
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toContain("pricing_region=india");
    expect(upsertPricingRegionPreference).toHaveBeenCalledWith({ DB: {} }, "user-1", "india");
  });
});
