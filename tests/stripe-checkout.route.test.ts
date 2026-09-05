import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import routes from "~/routes";

type RouteEntry = { path?: string; children?: RouteEntry[] };
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;
type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;

function createContext(env: Record<string, unknown> = {}) {
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
  vi.doUnmock("~/lib/commercial-launch-gate.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/dodo-pricing.server");
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
    expect(paths).not.toContain("pricing-region");
  });

  it("exposes Dodo-backed billing, price preview, and legal pages", () => {
    const paths = flattenRoutePaths(routes as RouteEntry[]);

    expect(paths.filter((path) => path.startsWith("api/billing/")).sort()).toEqual([
      "api/billing/dodo/canary",
      "api/billing/dodo/cancel",
      "api/billing/dodo/checkout",
      "api/billing/dodo/plan-change",
      "api/billing/dodo/portal",
    ]);
    expect(paths.filter((path) => path.startsWith("api/webhooks/"))).toEqual([
      "api/webhooks/dodo",
    ]);
    expect(paths).toContain("api/billing/dodo/checkout");
    expect(paths).toContain("api/billing/dodo/cancel");
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
    getCachedWorkspaceForRequest: vi.fn().mockImplementation(async () => ({
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
      showPresenceNav: false,
    });
  });
});

describe("marketing route", () => {
  it("renders customer-facing pricing with in-app plan intent for signed-in users", async () => {
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
          usageBundles: [
            {
              slug: "proof_500",
              name: "Proof Pack — 500",
              creditLabel: "500 extra proof captures",
              priceLabel: "$25",
              detail: "For a busy week.",
              creditQuantity: 500,
            },
          ],
          session,
        }),
        useLoaderData: vi.fn().mockReturnValue({
          pricingPreview: {
            available: true,
            prices: {
              starter: {
                monthly: { display: "$59", amount: 5900, currency: "USD" },
                yearly: { display: "$499", amount: 49900, currency: "USD" },
              },
            },
            annualValidation: {
              starter: {
                valid: true,
                reason: "valid_4_months_free",
                monthlyAmount: 5900,
                annualAmount: 47200,
                expectedAnnualAmount: 47200,
                currency: "USD",
              },
            },
            usageBundles: {
              proof_500: { display: "$25", amount: 2500, currency: "USD" },
            },
          },
          commercialLaunch: {
            scoutSaleOpen: true,
            starterSaleOpen: true,
            agencySaleOpen: false,
          },
        }),
      };
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).toContain("$59");
    expect(markup).toContain("$499");
    expect(markup).toContain("f9-toggle-savings");
    expect(markup).toContain("4 months free");
    expect(markup).toContain("About $2/day");
    expect(markup).not.toContain("INR");
    expect(markup).toContain("Recommended launch plan");
    expect(markup).toContain("Start with Starter");
    expect(markup).toContain("Proof capture packs");
    expect(markup).toContain("500 extra proof captures");
    expect(markup).toContain("$0.05 per proof capture");
    expect(markup).not.toContain("500 extra checks");
    expect(markup).not.toContain("Dodo preview");
    expect(markup).not.toContain("Buyer currency");
    expect(markup).toContain("Choose monthly");
    expect(markup).toContain("/app/billing?plan=starter&amp;cycle=monthly&amp;source=pricing#plans");
    expect(markup).toContain("/app/billing?source=top-up#top-ups");
    expect(markup).toContain("Manage packs");
    expect(markup).not.toContain("/api/billing/dodo/checkout");
    expect(markup).not.toContain("/pricing-region");
    expect(markup).not.toContain("Rest of world");
    expect(markup).not.toContain("/api/checkout");
  });

  it("keeps annual selectable when one open displayed annual plan validates", async () => {
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
              slug: "scout",
              name: "Scout",
              monthlyLabel: "Monthly price loading",
              yearlyLabel: "Annual price loading",
              detail: "Small team monitoring.",
              features: [],
            },
            {
              slug: "starter",
              name: "Starter",
              monthlyLabel: "Monthly price loading",
              yearlyLabel: "Annual price loading",
              detail: "Saved searches.",
              features: [],
            },
          ],
          usageBundles: [],
          session: null,
        }),
        useLoaderData: vi.fn().mockReturnValue({
          pricingPreview: {
            available: true,
            prices: {
              scout: {
                monthly: { display: "$29" },
                yearly: { display: "$232" },
              },
              starter: {
                monthly: { display: "$59" },
                yearly: { display: "$520" },
              },
            },
            annualValidation: {
              scout: {
                valid: true,
                reason: "valid_4_months_free",
              },
              starter: {
                planId: "starter",
                valid: false,
                reason: "amount_mismatch",
              },
            },
            usageBundles: {},
          },
          commercialLaunch: {
            scoutSaleOpen: true,
            starterSaleOpen: true,
            agencySaleOpen: false,
          },
        }),
      };
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).not.toContain("f9-toggle-savings");
    expect(markup).not.toContain("4 months free");
    expect(markup).toMatch(/<button[^>]*aria-disabled="false"[^>]*><span>Annual/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*><span>Annual/);
    expect(markup).not.toContain("cycle%3Dyearly");
    expect(markup).not.toContain("cycle=yearly");
  });

  it("preserves plan intent through signup for signed-out users", async () => {
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
              features: [],
            },
          ],
          usageBundles: [],
          session: null,
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
            annualValidation: {
              starter: {
                valid: true,
                reason: "valid_4_months_free",
              },
            },
            usageBundles: {},
          },
          commercialLaunch: {
            scoutSaleOpen: true,
            starterSaleOpen: true,
            agencySaleOpen: false,
          },
        }),
      };
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).toContain(
      "/auth/signup?redirectTo=%2Fapp%2Fbilling%3Fplan%3Dstarter%26cycle%3Dmonthly%26source%3Dpricing%23plans",
    );
    expect(markup).not.toContain("/api/billing/dodo/checkout");
  });

  it("preserves annual plan intent through signup for signed-out users", async () => {
    const { planIntentPath } = await import("~/routes/marketing");

    expect(planIntentPath(false, "starter", "yearly")).toBe(
      "/auth/signup?redirectTo=%2Fapp%2Fbilling%3Fplan%3Dstarter%26cycle%3Dyearly%26source%3Dpricing%23plans",
    );
  });

  it("derives annual savings from visible Dodo totals", async () => {
    const { valueMathLabel } = await import("~/routes/marketing");

    expect(
      valueMathLabel(
        {
          available: true,
          prices: {
            starter: {
              monthly: { display: "$59", amount: 5900, currency: "USD" },
              yearly: { display: "$499", amount: 49900, currency: "USD" },
            },
          },
          annualValidation: {
            starter: {
              valid: true,
              reason: "valid_4_months_free",
              monthlyAmount: 5900,
              annualAmount: 47200,
              expectedAnnualAmount: 47200,
              currency: "USD",
            },
          },
          usageBundles: {},
        },
        "starter",
        "yearly",
        true,
      ),
    ).toBe("Save $209 vs monthly");
  });

  it("does not send signed-out users to held Agency checkout", async () => {
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
              slug: "agency",
              name: "Agency",
              monthlyLabel: "Talk to us",
              yearlyLabel: "Talk to us",
              detail: "High-volume monitoring.",
              features: [],
            },
          ],
          usageBundles: [],
          session: null,
        }),
        useLoaderData: vi.fn().mockReturnValue({
          pricingPreview: {
            available: true,
            prices: {
              agency: {
                monthly: { display: "$199" },
                yearly: { display: "$1,592" },
              },
            },
            annualValidation: {
              agency: {
                valid: true,
                reason: "valid_4_months_free",
              },
            },
            usageBundles: {},
          },
          commercialLaunch: {
            scoutSaleOpen: true,
            starterSaleOpen: true,
            agencySaleOpen: false,
          },
        }),
      };
    });

    const { default: MarketingRoute } = await import("~/routes/marketing");
    const markup = renderToStaticMarkup(createElement(MarketingRoute));

    expect(markup).toContain("Account review");
    expect(markup).toContain("Agency is available by account review");
    // A2 retired the "Create account" nav link for a single "Open app";
    // signed-out users still reach signup via the final email CTA action.
    expect(markup).toContain('action="/auth/signup"');
    expect(markup).not.toContain("plan=agency");
    expect(markup).not.toContain("capacity review");
    expect(markup).not.toContain("higher-volume monitoring coverage");
  });
});

describe("pricing preview route", () => {
  it("keeps public pricing cacheable without exposing Worker identity", async () => {
    const previewDodo0509PlanPrices = vi.fn().mockResolvedValue({
      available: true,
      provider: "dodo",
      source: "dodo_checkout_preview",
      country: "US",
      prices: {},
      usageBundles: {},
    });
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({ CF_VERSION_METADATA: { id: "worker-v1" } })),
    }));
    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({
      publicCommercialLaunchSummary: vi.fn(() => ({})),
    }));

    const { loader } = await import("~/routes/api.pricing-preview");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/pricing-preview"),
    } as never);
    const payload = await response.json() as Record<string, unknown>;

    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(payload.workerVersionId).toBeUndefined();
    expect(previewDodo0509PlanPrices).toHaveBeenCalledTimes(1);
  });

  it("binds authenticated pricing proof to one Worker and rejects drift before Dodo", async () => {
    const previewDodo0509PlanPrices = vi.fn().mockResolvedValue({
      available: true,
      provider: "dodo",
      source: "dodo_checkout_preview",
      country: "US",
      prices: {},
      usageBundles: {},
    });
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        CANARY_BYPASS_TOKEN: "secret-token",
        CF_VERSION_METADATA: { id: "worker-v1" },
      })),
    }));
    vi.doMock("~/lib/dodo-pricing.server", () => ({ previewDodo0509PlanPrices }));
    vi.doMock("~/lib/commercial-launch-gate.server", () => ({
      publicCommercialLaunchSummary: vi.fn(() => ({})),
    }));

    const { loader } = await import("~/routes/api.pricing-preview");
    const matching = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/pricing-preview", {
        headers: {
          "x-0509-canary-token": "secret-token",
          "x-0509-expected-worker-version": "worker-v1",
        },
      }),
    } as never);
    expect(matching.status).toBe(200);
    expect(matching.headers.get("cache-control")).toBe("no-store");
    await expect(matching.json()).resolves.toMatchObject({ workerVersionId: "worker-v1" });

    const drifted = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/pricing-preview", {
        headers: {
          "x-0509-canary-token": "secret-token",
          "x-0509-expected-worker-version": "worker-v2",
        },
      }),
    } as never);
    expect(drifted.status).toBe(409);
    expect(drifted.headers.get("cache-control")).toBe("no-store");
    expect(previewDodo0509PlanPrices).toHaveBeenCalledTimes(1);
  });

  it("returns an unavailable Dodo preview until 0509 brand secrets and product ids are configured", async () => {
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));

    const { loader } = await import("~/routes/api.pricing-preview");
    const response = await loader({
      context: createContext(),
      request: new Request("https://0509.io/api/pricing-preview"),
    } as never);
    const payload = await response.json() as {
      commercialLaunch: Record<string, unknown>;
    } & Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      available: false,
      provider: "dodo",
      source: "dodo_checkout_preview",
      reason: "missing_api_key",
      prices: {},
      commercialLaunch: {
        scoutSaleOpen: false,
        starterSaleOpen: false,
        agencySaleOpen: false,
      },
    });
    expect(Object.keys(payload.commercialLaunch).sort()).toEqual([
      "agencySaleOpen",
      "scoutSaleOpen",
      "starterSaleOpen",
    ]);
    expect(JSON.stringify(payload)).not.toContain("fanout");
    expect(JSON.stringify(payload)).not.toContain("missingCheckoutSkus");
    expect(JSON.stringify(payload)).not.toContain("internalWorkspace");
  });
});
