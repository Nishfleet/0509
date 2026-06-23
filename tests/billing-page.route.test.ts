import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockLinkProps = { children?: ReactNode; to?: string } & Record<string, unknown>;
type MockFormProps = { children?: ReactNode } & Record<string, unknown>;

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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/monitoring.server");
});

function mockBillingLoaderDependencies(input: {
  billing: Record<string, unknown>;
}) {
  vi.doMock("~/lib/auth.server", () => ({
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({})),
  }));
  vi.doMock("~/lib/data.server", () => ({
    getUserPlanBillingInfo: vi.fn().mockResolvedValue(input.billing),
  }));
  vi.doMock("~/lib/monitoring.server", () => ({
    dailyProofCapForPlan: vi.fn(() => 40),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    PLAN_LIMITS: {
      free: { watchlists: 0, collections: 0, digests: false, digestCadence: "none", proofCapturesPerMonth: 0 },
      starter: { watchlists: 10, collections: 25, digests: true, digestCadence: "weekly", proofCapturesPerMonth: 250 },
    },
    checkPlanLimit: vi.fn(async (_env: unknown, _userId: string, resource: string) =>
      resource === "watchlists"
        ? { allowed: true, limit: 10, current: 3 }
        : { allowed: true, limit: 25, current: 5 },
    ),
    listActiveProofCreditGrants: vi.fn().mockResolvedValue([]),
    getProofUsageSummary: vi.fn().mockResolvedValue({
      plan: "starter",
      used: 40,
      baseLimit: 250,
      extraCredits: 0,
      limit: 250,
      remaining: 210,
      usageRatio: 0.16,
      warningLevel: "ok",
      upgradeTarget: "Agency",
    }),
  }));
}

function mockReactRouterRender(loaderData: unknown) {
  vi.doMock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    const React = await import("react");

    return {
      ...actual,
      Form: ({ children, ...props }: MockFormProps) =>
        React.createElement("form", props, children),
      Link: ({ children, to, ...props }: MockLinkProps) =>
        React.createElement("a", { ...props, href: typeof to === "string" ? to : "" }, children),
      useLoaderData: vi.fn().mockReturnValue(loaderData),
      useNavigation: vi.fn().mockReturnValue({ state: "idle" }),
    };
  });
}

describe("billing page", () => {
  it("loads plan, usage, and billing status for a paying customer", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        dodoProductId: "prod_starter_monthly",
        planUpdatedAt: "2026-06-04T12:00:00.000Z",
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      email: "owner@example.com",
      billing: { plan: "starter", dodoStatus: "succeeded" },
      watchlistUsage: { current: 3, limit: 10 },
      collectionUsage: { current: 5, limit: 25 },
      proofUsage: { used: 40, limit: 250 },
      blockedCheckout: false,
    });
  });

  it("flags a blocked duplicate checkout from the query string", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        dodoProductId: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=already-subscribed"),
      params: {},
    } as never);

    expect(result).toMatchObject({ blockedCheckout: true });
  });

  it("flags a pending checkout from the query string", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "free",
        dodoStatus: "checkout_pending",
        dodoProductId: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=already-started"),
      params: {},
    } as never);

    expect(result).toMatchObject({ pendingCheckout: true });
  });

  it("renders the payment-issue banner and support path for a dunning customer", async () => {
    mockReactRouterRender({
      email: "owner@example.com",
      billing: {
        plan: "starter",
        dodoStatus: "subscription.on_hold",
        dodoProductId: null,
        planUpdatedAt: "2026-06-04T12:00:00.000Z",
      },
      proofUsage: { used: 40, limit: 250, extraCredits: 0 },
      watchlistUsage: { current: 3, limit: 10 },
      collectionUsage: { current: 5, limit: 25 },
      planLimits: { digestCadence: "weekly" },
      dailyProofCap: 40,
      creditGrants: [],
      blockedCheckout: false,
      pendingCheckout: false,
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Payment issue");
    expect(markup).toContain("still active");
    expect(markup).toContain("support@0509.io");
    expect(markup).toContain("Cancellation");
    expect(markup).toContain("payment retry in progress");
  });

  it("points free users at pricing and never shows a cancel-needed state", async () => {
    mockReactRouterRender({
      email: "owner@example.com",
      billing: { plan: "free", dodoStatus: null, dodoProductId: null, planUpdatedAt: null },
      proofUsage: { used: 0, limit: 0, extraCredits: 0 },
      watchlistUsage: { current: 0, limit: 0 },
      collectionUsage: { current: 0, limit: 0 },
      planLimits: { digestCadence: "none" },
      dailyProofCap: 0,
      creditGrants: [],
      blockedCheckout: false,
      pendingCheckout: false,
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("View plans");
    expect(markup).toContain("/#pricing");
    expect(markup).toContain("Free account");
    expect(markup).not.toContain("Payment issue");
  });

  it("does not overpromise cancellation through the hosted billing portal", async () => {
    mockReactRouterRender({
      email: "owner@example.com",
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        dodoCustomerId: "cus_123",
        dodoProductId: "prod_starter",
        planUpdatedAt: "2026-06-04T12:00:00.000Z",
      },
      proofUsage: { used: 40, limit: 250, extraCredits: 0 },
      watchlistUsage: { current: 3, limit: 10 },
      collectionUsage: { current: 5, limit: 25 },
      planLimits: { digestCadence: "weekly" },
      dailyProofCap: 40,
      creditGrants: [],
      blockedCheckout: false,
      pendingCheckout: false,
      portalUnavailable: false,
      hasPortal: true,
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Open Dodo");
    expect(markup).toContain("subscription-update setting is confirmed");
    expect(markup).toContain("/app/support?category=billing");
    expect(markup).not.toContain("cancel — self-serve");
    expect(markup).not.toContain("100% customer satisfaction");
  });
});

describe("Dodo checkout double-subscription guard", () => {
  function mockCheckoutDependencies(currentPlan: string, options: { checkoutClaimed?: boolean; checkoutFails?: boolean } = {}) {
    const createDodo0509CheckoutSession = vi.fn().mockResolvedValue({
      checkoutUrl: "https://checkout.dodo.example/session",
      sessionId: "sess_1",
    });
    if (options.checkoutFails) {
      createDodo0509CheckoutSession.mockRejectedValue(new Response("Dodo checkout failed.", { status: 502 }));
    }
    const claimDodoPlanCheckout = vi.fn().mockResolvedValue(options.checkoutClaimed ?? true);
    const clearDodoPlanCheckout = vi.fn().mockResolvedValue(undefined);
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/plan.server", () => ({
      getUserPlan: vi.fn().mockResolvedValue(currentPlan),
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({
      createDodo0509CheckoutSession,
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimDodoPlanCheckout,
      clearDodoPlanCheckout,
    }));
    return { createDodo0509CheckoutSession, claimDodoPlanCheckout, clearDodoPlanCheckout };
  }

  function checkoutRequest(body: Record<string, string>) {
    return new Request("https://0509.io/api/billing/dodo/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  }

  afterEach(() => {
    vi.doUnmock("~/lib/dodo-billing.server");
  });

  it("redirects an already-subscribed user to billing instead of opening a second checkout", async () => {
    const { createDodo0509CheckoutSession } = mockCheckoutDependencies("starter");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ plan: "agency", cycle: "monthly" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?checkout=already-subscribed",
      );
    }

    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("lets a free user start a plan checkout", async () => {
    const { createDodo0509CheckoutSession } = mockCheckoutDependencies("free");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ plan: "starter", cycle: "monthly" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "https://checkout.dodo.example/session",
      );
    }

    expect(createDodo0509CheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("blocks a second pending Dodo plan checkout before opening another session", async () => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout } = mockCheckoutDependencies("free", {
      checkoutClaimed: false,
    });

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ plan: "starter", cycle: "monthly" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?checkout=already-started",
      );
    }

    expect(claimDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), { userId: "user-1" });
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("clears the pending Dodo plan checkout lock when Dodo session creation fails", async () => {
    const { clearDodoPlanCheckout } = mockCheckoutDependencies("free", { checkoutFails: true });

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    await expect(
      action({
        context: {},
        request: checkoutRequest({ plan: "starter", cycle: "monthly" }),
        params: {},
      } as never),
    ).rejects.toBeInstanceOf(Response);

    expect(clearDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("still lets a subscriber buy usage bundles", async () => {
    const { createDodo0509CheckoutSession } = mockCheckoutDependencies("starter");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ bundle: "proof_500" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "https://checkout.dodo.example/session",
      );
    }

    expect(createDodo0509CheckoutSession).toHaveBeenCalledTimes(1);
  });
});

describe("Dodo customer portal route", () => {
  afterEach(() => {
    vi.doUnmock("~/lib/dodo-billing.server");
  });

  it("303s into a fresh portal session for a linked customer", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        plan: "starter",
        dodoCustomerId: "cus_123",
      }),
    }));
    const createDodoCustomerPortalSession = vi
      .fn()
      .mockResolvedValue("https://portal.dodo.example/session");
    vi.doMock("~/lib/dodo-billing.server", () => ({ createDodoCustomerPortalSession }));

    const { action } = await import("~/routes/api.billing.dodo.portal");

    try {
      await action({
        context: {},
        request: new Request("https://0509.io/api/billing/dodo/portal", { method: "POST" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "https://portal.dodo.example/session",
      );
    }
    expect(createDodoCustomerPortalSession).toHaveBeenCalledWith(expect.anything(), "cus_123");
  });

  it("falls back to the billing page when no Dodo customer is linked", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      workspaceUserId: session.user.id,
      isMember: false,
      ownerName: null,
    })),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getUserPlanBillingInfo: vi.fn().mockResolvedValue({
        plan: "starter",
        dodoCustomerId: null,
      }),
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({
      createDodoCustomerPortalSession: vi.fn(),
    }));

    const { action } = await import("~/routes/api.billing.dodo.portal");

    try {
      await action({
        context: {},
        request: new Request("https://0509.io/api/billing/dodo/portal", { method: "POST" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?portal=unavailable",
      );
    }
  });
});
