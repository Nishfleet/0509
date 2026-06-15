import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import routes from "~/routes";

type RouteEntry = { path?: string; children?: RouteEntry[] };
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function createContext(env: Record<string, string> = {}) {
  return {
    cloudflare: {
      env,
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
  it("does not expose generic checkout, Stripe webhook, or pricing-region endpoints", () => {
    const paths = flattenRoutePaths(routes as RouteEntry[]);

    expect(paths).not.toContain("api/checkout");
    expect(paths).not.toContain("api/webhooks/stripe");
    expect(paths).not.toContain("api/billing/razorpay/subscription");
    expect(paths).not.toContain("api/webhooks/razorpay");
    expect(paths).not.toContain("pricing-region");
  });

  it("exposes Dodo-backed billing, price preview, and legal pages", () => {
    const paths = flattenRoutePaths(routes as RouteEntry[]);

    expect(paths).toContain("api/billing/dodo/checkout");
    expect(paths).toContain("api/billing/dodo/canary");
    expect(paths).toContain("api/pricing-preview");
    expect(paths).toContain("api/webhooks/dodo");
    expect(paths).toContain("privacy");
    expect(paths).toContain("terms");
  });
});

describe("app layout loader", () => {
  it("returns only session data for workspace chrome", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
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
  it("renders customer-facing pricing with purchase forms for signed-in users", async () => {
    vi.doMock("react-router", async () => {
      const actual = await vi.importActual<typeof import("react-router")>("react-router");
      const React = await import("react");

      return {
        ...actual,
        Form: ({ children, ...props }: MockFormProps) =>
          React.createElement("form", props, children),
        Link: ({ children, to, ...props }: MockLinkProps) =>
          React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
        useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
        useRouteLoaderData: vi.fn().mockReturnValue({
          pricingPlans: [
            {
              slug: "starter",
              name: "Starter",
              monthlyLabel: "Monthly price loading",
              yearlyLabel: "Annual price loading",
              detail: "Saved searches.",
            },
          ],
          usageBundles: [],
          session,
        }),
        useLoaderData: vi.fn().mockReturnValue({
          pricingPreview: {
            available: true,
            prices: {
              starter: {
                monthly: { display: "$59" },
                yearly: { display: "$499" },
              },
            },
            usageBundles: {},
          },
        }),
      };
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).toContain("$59");
    expect(markup).toContain("$499");
    expect(markup).not.toContain("INR");
    expect(markup).toContain("Recommended launch plan");
    expect(markup).toContain("Start with Starter");
    expect(markup).not.toContain("Dodo preview");
    expect(markup).not.toContain("Buyer currency");
    expect(markup).toContain("Start monthly");
    expect(markup).toContain("/api/billing/dodo/checkout");
    expect(markup).not.toContain("/pricing-region");
    expect(markup).not.toContain("Rest of world");
    expect(markup).not.toContain("/api/billing/razorpay/subscription");
    expect(markup).not.toContain("/api/checkout");
  });
});

describe("pricing preview route", () => {
  it("returns an unavailable Dodo preview until 0509 brand secrets and product ids are configured", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));

    const { loader } = await import("~/routes/api.pricing-preview");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/pricing-preview"),
    } as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      available: false,
      provider: "dodo",
      source: "dodo_checkout_preview",
      reason: "missing_api_key",
      prices: {},
    });
  });
});
