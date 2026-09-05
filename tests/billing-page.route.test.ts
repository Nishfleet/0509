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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react-router");
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/dodo-billing.server");
  vi.doUnmock("~/lib/dodo-pricing.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/monitoring.server");
  vi.doUnmock("~/lib/rate-limit.server");
});

function mockBillingLoaderDependencies(input: {
  billing: Record<string, unknown>;
  workspace?: {
    workspaceUserId?: string;
    isMember?: boolean;
    ownerName?: string | null;
  };
}) {
  const workspace = {
    workspaceUserId: input.workspace?.workspaceUserId ?? session.user.id,
    isMember: input.workspace?.isMember ?? false,
    ownerName: input.workspace?.ownerName ?? null,
  };
  const getUserPlanBillingInfo = vi.fn().mockResolvedValue(input.billing);
  const previewDodo0509PlanPrices = vi.fn().mockResolvedValue({
    available: false,
    prices: {},
    annualValidation: {},
    usageBundles: {},
  });
  const validateDodo0509PlanCheckout = vi.fn().mockResolvedValue({
    valid: true,
    price: { currency: "INR" },
    pricingContext: {
      billingCountry: "IN",
      billingCurrency: "INR",
    },
  });
  const enforceBillingProviderRateLimit = vi.fn().mockResolvedValue(null);
  const checkPlanLimit = vi.fn(async (_env: unknown, _userId: string, resource: string) =>
    resource === "watchlists"
      ? { allowed: true, limit: 10, current: 3 }
      : { allowed: true, limit: 25, current: 5 },
  );
  const listActiveProofCreditGrants = vi.fn().mockResolvedValue([]);
  const getProofUsageSummary = vi.fn().mockResolvedValue({
    plan: "starter",
    used: 40,
    baseLimit: 250,
    extraCredits: 0,
    limit: 250,
    remaining: 210,
    usageRatio: 0.16,
    warningLevel: "ok",
    upgradeTarget: "Agency",
  });
  vi.doMock("~/lib/auth.server", () => ({
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      ...workspace,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({})),
  }));
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforceBillingProviderRateLimit,
  }));
  vi.doMock("~/lib/data.server", () => ({
    getUserPlanBillingInfo,
  }));
  vi.doMock("~/lib/monitoring.server", () => ({
    dailyProofCapForPlan: vi.fn(() => 40),
  }));
  vi.doMock("~/lib/dodo-pricing.server", () => ({
    previewDodo0509PlanPrices,
    validateDodo0509PlanCheckout,
  }));
  vi.doMock("~/lib/plan.server", () => ({
    PLAN_LIMITS: {
      free: { watchlists: 1, collections: 0, digests: false, digestCadence: "none", proofCapturesPerMonth: 0 },
      starter: { watchlists: 10, collections: 25, digests: true, digestCadence: "weekly", proofCapturesPerMonth: 250 },
    },
    checkPlanLimit,
    listActiveProofCreditGrants,
    getProofUsageSummary,
  }));
  return {
    checkPlanLimit,
    enforceBillingProviderRateLimit,
    getProofUsageSummary,
    getUserPlanBillingInfo,
    listActiveProofCreditGrants,
    previewDodo0509PlanPrices,
    validateDodo0509PlanCheckout,
  };
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
      useRevalidator: vi.fn().mockReturnValue({ revalidate: vi.fn() }),
    };
  });
}

function billingRenderData(overrides: Record<string, unknown> = {}) {
  const base = {
    email: "owner@example.com",
    billing: { plan: "free", dodoStatus: null, billingInterval: null, planUpdatedAt: null },
    proofUsage: { used: 0, baseLimit: 0, limit: 0, extraCredits: 0 },
    watchlistUsage: { current: 0, limit: 0 },
    collectionUsage: { current: 0, limit: 0 },
    planLimits: { digestCadence: "none" },
    dailyProofCap: 0,
    creditGrants: [],
    canManageBilling: true,
    billingOwnerName: null,
    selectedPlan: "starter",
    selectedCycle: "monthly",
    selectedSource: null,
    checkoutReturned: false,
    checkoutStartedAt: null,
    legacyPlanReturnConfirmed: false,
    blockedCheckout: false,
    pendingCheckout: false,
    invalidCheckoutTarget: false,
    agencyCheckoutHeld: false,
    planCheckoutUnavailable: false,
    annualCheckoutUnavailable: false,
    topUpRequiresPlan: false,
    topUpCheckoutUnavailable: false,
    portalUnavailable: false,
    hasPortal: false,
    hasDodoSubscription: false,
    planChangeNotice: null,
    pricingPreview: {
      available: true,
      prices: {
        scout: {
          monthly: { display: "$19" },
          yearly: { display: "$152" },
        },
        starter: {
          monthly: { display: "$59" },
          yearly: { display: "$472" },
        },
        agency: {
          monthly: { display: "$199" },
          yearly: { display: "$1,592" },
        },
      },
      annualValidation: {
        scout: { planId: "scout", valid: true, reason: "valid_4_months_free" },
        starter: { planId: "starter", valid: true, reason: "valid_4_months_free" },
        agency: { planId: "agency", valid: true, reason: "valid_4_months_free" },
      },
      usageBundles: {
        proof_500: { display: "$25" },
        proof_2000: { display: "$80" },
        proof_7500: { display: "$240" },
      },
    },
    commercialLaunch: {
      scoutSaleOpen: true,
      starterSaleOpen: true,
      agencySaleOpen: false,
    },
  };
  return {
    ...base,
    ...overrides,
    billing: {
      ...base.billing,
      ...((overrides.billing as Record<string, unknown> | undefined) ?? {}),
    },
    pricingPreview: {
      ...base.pricingPreview,
      ...((overrides.pricingPreview as Record<string, unknown> | undefined) ?? {}),
    },
    commercialLaunch: {
      ...base.commercialLaunch,
      ...((overrides.commercialLaunch as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

describe("billing page", () => {
  it("maps an invalid checkout redirect to durable billing-page feedback", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "free",
        dodoStatus: null,
        dodoProductId: null,
        dodoPlanChangeProductId: null,
        billingInterval: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=invalid-target"),
      params: {},
    } as never);

    expect(result).toMatchObject({ invalidCheckoutTarget: true });
  });

  it("renders invalid checkout feedback as an assertive inline error", async () => {
    mockReactRouterRender(billingRenderData({ invalidCheckoutTarget: true }));
    const { default: BillingRoute } = await import("~/routes/app.billing");

    const markup = renderToStaticMarkup(createElement(BillingRoute));
    expect(markup).toContain("That checkout option is invalid or no longer available.");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="assertive"');
  });

  it("loads plan, usage, and billing status for a paying customer", async () => {
    const mocks = mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        dodoProductId: "prod_starter_monthly",
        dodoPlanChangeProductId: "prod_starter_annual",
        billingInterval: "monthly",
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
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        billingInterval: "monthly",
        hasDodoPlanChangePendingTarget: true,
      },
      watchlistUsage: { current: 3, limit: 10 },
      collectionUsage: { current: 5, limit: 25 },
      proofUsage: { used: 40, limit: 250 },
      blockedCheckout: false,
    });
    expect(JSON.stringify(result)).not.toContain("prod_starter_monthly");
    expect(JSON.stringify(result)).not.toContain("prod_starter_annual");
    expect(result.billing).not.toHaveProperty("dodoProductId");
    expect(result.billing).not.toHaveProperty("dodoPlanChangeProductId");
    expect(result.billing).not.toHaveProperty("dodoSubscriptionId");
    expect(result.billing).not.toHaveProperty("dodoCustomerId");
    // WP-A3.3: billing resolves buyer currency identically to the public
    // /api/pricing-preview surface — it must NOT force trustProxyHeaders: false,
    // which was the cause of the ₹-vs-$ mismatch for one browser.
    expect(mocks.previewDodo0509PlanPrices).toHaveBeenCalledWith(
      expect.not.objectContaining({
        trustProxyHeaders: false,
      }),
    );
  });

  it("fails closed before billing pricing reaches Dodo", async () => {
    const mocks = mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: "subscription.active",
        billingInterval: "monthly",
        planUpdatedAt: "2026-06-04T12:00:00.000Z",
      },
    });
    mocks.enforceBillingProviderRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limit_unavailable" }), { status: 503 }),
    );
    const { loader } = await import("~/routes/app.billing");
    const response = (await loader({
      context: {},
      request: new Request("https://0509.io/app/billing"),
      params: {},
    } as never).catch((error) => error)) as Response;
    expect(response.status).toBe(503);
    expect(mocks.previewDodo0509PlanPrices).not.toHaveBeenCalled();
  });

  it("derives plan-change preview amounts server-side instead of trusting URL params", async () => {
    const mocks = mockBillingLoaderDependencies({
      billing: {
        plan: "scout",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
        dodoProductId: "prod_scout_monthly",
        billingInterval: "monthly",
        planUpdatedAt: "2026-06-04T12:00:00.000Z",
      },
    });
    const previewDodo0509SubscriptionPlanChange = vi.fn().mockResolvedValue({
      immediate_charge: {
        summary: {
          total_amount: 1234,
        },
      },
    });
    const getDodo0509SubscriptionCurrency = vi.fn().mockResolvedValue("INR");
    const createDodoSubscriptionPlanChangePreviewToken = vi.fn().mockResolvedValue("preview_token_123");
    const summarizeDodoSubscriptionPlanChangePreview = vi.fn(() => ({
      amount: 1234,
      currency: "INR",
      display: "₹12.34",
    }));
    vi.doMock("~/lib/dodo-billing.server", () => ({
      checkoutTargetFromSkuSlug: vi.fn((sku: string) => ({
        kind: "plan",
        sku,
        planFamily: "starter",
        cycle: "monthly",
      })),
      createDodoSubscriptionPlanChangePreviewToken,
      getDodo0509SubscriptionCurrency,
      previewDodo0509SubscriptionPlanChange,
      summarizeDodoSubscriptionPlanChangePreview,
    }));

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request(
        "https://0509.io/app/billing?plan-change=preview&plan=starter&cycle=monthly&sku=starter_monthly_v1&charge=$0.00&effective=immediately",
      ),
      params: {},
    } as never);

    expect(result.planChangePreview).toEqual({
      plan: "starter",
      cycle: "monthly",
      sku: "starter_monthly_v1",
      effectiveAt: "immediately",
      charge: "₹12.34",
      previewToken: "preview_token_123",
    });
    expect(mocks.validateDodo0509PlanCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "starter", cycle: "monthly" }),
    );
    expect(previewDodo0509SubscriptionPlanChange).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_123", userId: "user-1" }),
    );
    expect(getDodo0509SubscriptionCurrency).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_123" }),
    );
    expect(summarizeDodoSubscriptionPlanChangePreview).toHaveBeenCalledWith(
      expect.any(Object),
      "INR",
    );
    expect(createDodoSubscriptionPlanChangePreviewToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subscriptionId: "sub_123",
        amount: 1234,
        currency: "INR",
      }),
    );
  });

  it("does not load owner plan-change previews for read-only workspace members", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "scout",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
        dodoProductId: "prod_scout_monthly",
        billingInterval: "monthly",
        planUpdatedAt: "2026-06-04T12:00:00.000Z",
      },
      workspace: {
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Agency Owner",
      },
    });
    const previewDodo0509SubscriptionPlanChange = vi.fn();
    vi.doMock("~/lib/dodo-billing.server", () => ({
      checkoutTargetFromSkuSlug: vi.fn(),
      createDodoSubscriptionPlanChangePreviewToken: vi.fn(),
      getDodo0509SubscriptionCurrency: vi.fn(),
      previewDodo0509SubscriptionPlanChange,
      summarizeDodoSubscriptionPlanChangePreview: vi.fn(),
    }));

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request(
        "https://0509.io/app/billing?plan-change=preview&plan=starter&cycle=monthly&sku=starter_monthly_v1&effective=immediately",
      ),
      params: {},
    } as never);

    expect(result.canManageBilling).toBe(false);
    expect(result.planChangeNotice).toBeNull();
    expect(result.planChangePreview).toBeNull();
    expect(previewDodo0509SubscriptionPlanChange).not.toHaveBeenCalled();
  });

  it("loads workspace owner billing for members without granting billing controls", async () => {
    const mocks = mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        dodoProductId: "prod_starter_monthly",
        planUpdatedAt: "2026-06-04T12:00:00.000Z",
      },
      workspace: {
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Agency Owner",
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      billing: { plan: "starter", dodoStatus: "succeeded" },
      canManageBilling: false,
      billingOwnerName: "Agency Owner",
    });
    expect(mocks.getUserPlanBillingInfo).toHaveBeenCalledWith(expect.anything(), "owner-1");
    expect(mocks.getProofUsageSummary).toHaveBeenCalledWith(expect.anything(), "owner-1");
    expect(mocks.checkPlanLimit).toHaveBeenCalledWith(expect.anything(), "owner-1", "watchlists");
    expect(mocks.checkPlanLimit).toHaveBeenCalledWith(expect.anything(), "owner-1", "collections");
    expect(mocks.listActiveProofCreditGrants).toHaveBeenCalledWith(expect.anything(), "owner-1");
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

  it("flags a pending checkout from billing state without a query string", async () => {
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
      request: new Request("https://0509.io/app/billing"),
      params: {},
    } as never);

    expect(result).toMatchObject({ pendingCheckout: true });
  });

  it("shows Dodo return confirmation without the generic pending checkout warning", async () => {
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
      request: new Request("https://0509.io/app/billing?checkout=dodo"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      checkoutReturned: true,
      pendingCheckout: false,
    });
  });

  it("marks a legacy monthly plan return as confirmed only when it matches current billing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:05:00.000Z"));
    mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        dodoProductId: null,
        billingInterval: "monthly",
        planUpdatedAt: "2026-07-01T10:01:00.000Z",
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=dodo&kind=plan&plan=starter&cycle=monthly"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      checkoutReturned: true,
      legacyPlanReturnConfirmed: true,
      pendingCheckout: false,
    });
  });

  it("does not confirm a stale bookmarked legacy monthly return", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T10:30:00.000Z"));
    mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        dodoProductId: null,
        billingInterval: "monthly",
        planUpdatedAt: "2026-07-01T10:01:00.000Z",
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=dodo&kind=plan&plan=starter&cycle=monthly"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      checkoutReturned: true,
      legacyPlanReturnConfirmed: false,
      pendingCheckout: false,
    });
  });

  it("flags agency-held checkout from the query string", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "free",
        dodoStatus: null,
        dodoProductId: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=agency-held"),
      params: {},
    } as never);

    expect(result).toMatchObject({ agencyCheckoutHeld: true });
  });

  it("flags annual-unavailable checkout from the query string", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "free",
        dodoStatus: null,
        dodoProductId: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=annual-unavailable&plan=starter"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      annualCheckoutUnavailable: true,
      selectedPlan: "starter",
    });
  });

  it("flags top-up-requires-plan checkout from the query string", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "free",
        dodoStatus: null,
        dodoProductId: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=top-up-requires-plan"),
      params: {},
    } as never);

    expect(result).toMatchObject({ topUpRequiresPlan: true });
  });

  it("flags top-up-unavailable checkout from the query string", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: null,
        dodoProductId: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?checkout=top-up-unavailable"),
      params: {},
    } as never);

    expect(result).toMatchObject({ topUpCheckoutUnavailable: true });
  });

  it("normalizes selected billing picker params in the loader", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "free",
        dodoStatus: null,
        dodoProductId: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?plan=scout&cycle=yearly&source=pricing"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      selectedPlan: "scout",
      selectedCycle: "yearly",
      selectedSource: "pricing",
    });
  });

  it("falls back to safe billing picker params when the query string is malformed", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "free",
        dodoStatus: null,
        dodoProductId: null,
        planUpdatedAt: null,
      },
    });

    const { loader } = await import("~/routes/app.billing");
    const result = await loader({
      context: {},
      request: new Request("https://0509.io/app/billing?plan=enterprise&cycle=forever&source=<script>"),
      params: {},
    } as never);

    expect(result).toMatchObject({
      selectedPlan: "starter",
      selectedCycle: "monthly",
      selectedSource: null,
    });
  });

  it("defaults the picker to annual for an activated annual subscription", async () => {
    mockBillingLoaderDependencies({
      billing: {
        plan: "starter",
        dodoStatus: "subscription.active",
        dodoProductId: "prod_starter_annual",
        billingInterval: "annual",
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
      billing: { plan: "starter", billingInterval: "annual" },
      selectedCycle: "yearly",
    });
  });

  it("renders the portal payment-method CTA and support fallback for a dunning owner", async () => {
    mockReactRouterRender(
      billingRenderData({
        billing: {
          plan: "starter",
          dodoStatus: "subscription.on_hold",
          dodoCustomerId: "cus_123",
          dodoProductId: null,
          billingInterval: "monthly",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        hasPortal: true,
        proofUsage: { used: 40, baseLimit: 250, limit: 250, extraCredits: 0 },
        watchlistUsage: { current: 3, limit: 10 },
        collectionUsage: { current: 5, limit: 25 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Payment issue");
    expect(markup).toContain("still active");
    expect(markup).toContain("Update payment method");
    expect(markup).toContain('action="/api/billing/dodo/portal"');
    expect(markup).toContain("support@0509.io");
    expect(markup).toContain("Cancellation");
    expect(markup).toContain("payment issue needs attention");
    expect(markup).not.toContain("payment retry in progress");
  });

  it("keeps the dunning banner support-backed when the Dodo portal is unavailable", async () => {
    mockReactRouterRender(
      billingRenderData({
        billing: {
          plan: "starter",
          dodoStatus: "subscription.on_hold",
          dodoProductId: null,
          billingInterval: "monthly",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        hasPortal: false,
        proofUsage: { used: 40, baseLimit: 250, limit: 250, extraCredits: 0 },
        watchlistUsage: { current: 3, limit: 10 },
        collectionUsage: { current: 5, limit: 25 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Payment issue");
    expect(markup).toContain("receipt email from Dodo Payments");
    expect(markup).not.toContain("Update payment method");
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
    expect(markup).toContain("/app/billing?source=billing#plans");
    expect(markup).toContain("Free account");
    expect(markup).not.toContain("Payment issue");
  });

  it("renders a Dodo-validated monthly plan checkout form for free users", async () => {
    mockReactRouterRender(billingRenderData({ selectedSource: "pricing" }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Start monthly");
    expect(markup).toContain('action="/api/billing/dodo/checkout"');
    expect(markup).toContain('name="sku"');
    expect(markup).toContain('value="starter_monthly_v1"');
    expect(markup).toContain('name="source"');
    expect(markup).toContain('value="pricing"');
    expect(markup).toContain("Prices are shown in your local currency automatically");
    expect(markup).not.toContain("Every plan checkout must validate");
  });

  it("keeps plan checkout disabled while a pending Dodo checkout exists", async () => {
    mockReactRouterRender(
      billingRenderData({
        pendingCheckout: true,
        billing: {
          plan: "free",
          dodoStatus: "checkout_pending",
        },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("A Dodo checkout is already open");
    expect(markup).not.toContain("Start monthly");
    expect(markup).not.toContain('action="/api/billing/dodo/checkout"');
  });

  it("renders annual billing state for activated annual subscribers", async () => {
    mockReactRouterRender(
      billingRenderData({
        selectedCycle: "yearly",
        billing: {
          plan: "starter",
          dodoStatus: "subscription.active",
          billingInterval: "annual",
          dodoProductId: "prod_starter_annual",
          dodoNextBillingAt: "2027-06-04T12:00:00.000Z",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        proofUsage: { used: 40, baseLimit: 250, limit: 250, extraCredits: 0 },
        watchlistUsage: { current: 3, limit: 10 },
        collectionUsage: { current: 5, limit: 25 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Billing cycle");
    expect(markup).toContain("Annual");
    expect(markup).toContain('aria-current="true"');
    expect(markup).not.toContain("Start annual");
  });

  it("renders Dodo plan-change controls for paid owners with linked subscriptions", async () => {
    mockReactRouterRender(
      billingRenderData({
        billing: {
          plan: "scout",
          dodoStatus: "subscription.active",
          billingInterval: "monthly",
          dodoProductId: "prod_scout_monthly",
          dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        hasPortal: true,
        hasDodoSubscription: true,
        proofUsage: { used: 40, baseLimit: 50, limit: 50, extraCredits: 0 },
        watchlistUsage: { current: 2, limit: 3 },
        collectionUsage: { current: 4, limit: 10 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain('action="/api/billing/dodo/plan-change"');
    expect(markup).toContain('value="starter_monthly_v1"');
    expect(markup).toContain("Preview switch");
    expect(markup).toContain("Current plan");
    expect(markup).not.toContain("Change with support");
  });

  it("routes paid owners without linked Dodo subscriptions to billing support", async () => {
    mockReactRouterRender(
      billingRenderData({
        billing: {
          plan: "scout",
          dodoStatus: "subscription.active",
          billingInterval: "monthly",
          dodoProductId: "prod_scout_monthly",
          dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        hasDodoSubscription: false,
        proofUsage: { used: 40, baseLimit: 50, limit: 50, extraCredits: 0 },
        watchlistUsage: { current: 2, limit: 3 },
        collectionUsage: { current: 4, limit: 10 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain('href="/app/support?category=billing"');
    expect(markup).toContain("Request billing help");
    expect(markup).not.toContain('action="/api/billing/dodo/plan-change"');
    expect(markup).not.toContain("Price loading");
  });

  it("keeps old pending Dodo plan changes blocked while offering one no-resend status check", async () => {
    mockReactRouterRender(
      billingRenderData({
        billing: {
          plan: "scout",
          dodoStatus: "plan_change_pending",
          billingInterval: "monthly",
          dodoProductId: "prod_scout_monthly",
          dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
          planUpdatedAt: "2026-01-04T12:00:00.000Z",
        },
        hasPortal: true,
        hasDodoSubscription: true,
        proofUsage: { used: 40, baseLimit: 50, limit: 50, extraCredits: 0 },
        watchlistUsage: { current: 2, limit: 3 },
        collectionUsage: { current: 4, limit: 10 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Active — plan change pending");
    expect(markup).toContain("Change pending");
    expect(markup).not.toContain("Preview switch");
    expect(markup).toContain("No second plan change will be sent");
    expect(markup).toContain("Check Dodo status");
    expect(markup).toContain('action="/api/billing/dodo/plan-change"');
    expect(markup).toMatch(/<input[^>]*name="intent"[^>]*value="reconcile"/);
    expect(markup).toContain('href="/app/support?category=billing"');
  });

  it("renders honest terminal notices after provider-state reconciliation", async () => {
    for (const [notice, expected] of [
      ["recovered", "Dodo confirms no plan change was applied"],
      ["reconciled", "Dodo confirms the plan change"],
      ["status-refreshed", "Billing changed while we checked"],
    ] as const) {
      mockReactRouterRender(billingRenderData({ planChangeNotice: notice }));
      const { default: BillingRoute } = await import("~/routes/app.billing");
      expect(renderToStaticMarkup(createElement(BillingRoute))).toContain(expected);
      vi.resetModules();
    }
  });

  it("labels accepted next-cycle Dodo plan changes as scheduled", async () => {
    mockReactRouterRender(
      billingRenderData({
        billing: {
          plan: "starter",
          dodoStatus: "plan_change_scheduled",
          billingInterval: "annual",
          dodoProductId: "prod_starter_annual",
          dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        hasPortal: true,
        hasDodoSubscription: true,
        proofUsage: { used: 40, baseLimit: 250, limit: 250, extraCredits: 0 },
        watchlistUsage: { current: 2, limit: 10 },
        collectionUsage: { current: 4, limit: 25 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Active — plan change scheduled");
    expect(markup).not.toContain("Active — plan change pending");
    expect(markup).toContain("Change pending");
    expect(markup).not.toContain("Preview switch");
  });

  it("keeps scheduled Dodo cancellations out of the plan-change preview flow", async () => {
    mockReactRouterRender(
      billingRenderData({
        billing: {
          plan: "scout",
          dodoStatus: "cancellation_scheduled",
          billingInterval: "monthly",
          dodoProductId: "prod_scout_monthly",
          dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        hasPortal: true,
        hasDodoSubscription: true,
        proofUsage: { used: 40, baseLimit: 50, limit: 50, extraCredits: 0 },
        watchlistUsage: { current: 2, limit: 3 },
        collectionUsage: { current: 4, limit: 10 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Active — cancels at the end of this billing period");
    expect(markup).toContain("Cancellation scheduled");
    expect(markup).not.toContain("Preview switch");
    expect(markup).not.toContain('action="/api/billing/dodo/plan-change"');
  });

  it("keeps Agency on support instead of posting to the Scout/Starter plan-change route", async () => {
    mockReactRouterRender(
      billingRenderData({
        billing: {
          plan: "scout",
          dodoStatus: "subscription.active",
          billingInterval: "monthly",
          dodoProductId: "prod_scout_monthly",
          dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        commercialLaunch: {
          agencySaleOpen: true,
        },
        hasPortal: true,
        hasDodoSubscription: true,
        proofUsage: { used: 40, baseLimit: 50, limit: 50, extraCredits: 0 },
        watchlistUsage: { current: 2, limit: 3 },
        collectionUsage: { current: 4, limit: 10 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).not.toContain('value="agency_monthly_v1"');
    expect(markup).toContain("Request Agency access");
  });

  it("renders workspace member billing as read-only without checkout controls", async () => {
    mockReactRouterRender(
      billingRenderData({
        canManageBilling: false,
        billingOwnerName: "Agency Owner",
        billing: {
          plan: "starter",
          dodoStatus: "succeeded",
          dodoCustomerId: "cus_123",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
        hasPortal: true,
        proofUsage: { used: 40, baseLimit: 250, limit: 250, extraCredits: 0 },
        watchlistUsage: { current: 3, limit: 10 },
        collectionUsage: { current: 5, limit: 25 },
        planLimits: { digestCadence: "weekly" },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Billing is managed by the workspace owner, Agency Owner");
    expect(markup).toContain("Owner managed");
    expect(markup).not.toContain('action="/api/billing/dodo/checkout"');
    expect(markup).not.toContain("Start monthly");
    expect(markup).not.toContain("Buy pack");
    expect(markup).not.toContain("Open billing portal");
  });

  it("keeps annual checkout disabled when Dodo savings validation fails", async () => {
    mockReactRouterRender(
      billingRenderData({
        selectedCycle: "yearly",
        pricingPreview: {
          annualValidation: {
            scout: { planId: "scout", valid: true, reason: "valid_4_months_free" },
            starter: { planId: "starter", valid: false, reason: "amount_mismatch" },
            agency: { planId: "agency", valid: true, reason: "valid_4_months_free" },
          },
        },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Annual unavailable");
    expect(markup).toContain("does not validate as 4 months free");
    expect(markup).not.toContain('value="starter_annual_v1"');
  });

  it("keeps held Scout and Starter checkout out of Agency access copy", async () => {
    for (const scenario of [
      { plan: "scout", name: "Scout", saleFlag: "scoutSaleOpen", sku: "scout_monthly_v1" },
      { plan: "starter", name: "Starter", saleFlag: "starterSaleOpen", sku: "starter_monthly_v1" },
    ]) {
      vi.resetModules();
      mockReactRouterRender(
        billingRenderData({
          selectedPlan: scenario.plan,
          commercialLaunch: {
            [scenario.saleFlag]: false,
          },
        }),
      );

      const { default: BillingRoute } = await import("~/routes/app.billing");
      const markup = renderToStaticMarkup(createElement(BillingRoute));
      const selectedCard = markup.match(
        new RegExp(
          `<section class="[^"]*is-selected[^"]*">[\\s\\S]*?<span class="f9-wk-kick">${scenario.name}<\\/span>[\\s\\S]*?<\\/section>`,
        ),
      )?.[0];

      expect(selectedCard).toContain("Checkout unavailable");
      expect(selectedCard).not.toContain("Request Agency access");
      expect(selectedCard).not.toContain(`value="${scenario.sku}"`);
    }
  });

  it("keeps Agency checkout held in the in-app picker", async () => {
    mockReactRouterRender(billingRenderData({ selectedPlan: "agency" }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Request Agency access");
    expect(markup).not.toContain('value="agency_monthly_v1"');
  });

  it("keeps free Agency checkout reachable when Agency sales are open", async () => {
    mockReactRouterRender(
      billingRenderData({
        selectedPlan: "agency",
        commercialLaunch: {
          agencySaleOpen: true,
        },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain('action="/api/billing/dodo/checkout"');
    expect(markup).toContain('value="agency_monthly_v1"');
    expect(markup).toContain("Start monthly");
  });

  it("auto-rechecks activation when a buyer returns from Dodo checkout", async () => {
    mockReactRouterRender(billingRenderData({ checkoutReturned: true }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Dodo is confirming the payment");
    expect(markup).toContain("check again automatically");
  });

  it("does not confirm a plan return from an older paid plan update", async () => {
    mockReactRouterRender(
      billingRenderData({
        checkoutReturned: true,
        checkoutStartedAt: "2026-07-01T10:00:00.000Z",
        billing: {
          plan: "starter",
          planUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Dodo is confirming the payment");
    expect(markup).not.toContain("Your Starter plan is live");
  });

  it("confirms a matched legacy monthly plan return without a started timestamp", async () => {
    mockReactRouterRender(
      billingRenderData({
        checkoutReturned: true,
        legacyPlanReturnConfirmed: true,
        billing: {
          plan: "starter",
          billingInterval: "monthly",
          planUpdatedAt: "2026-07-01T10:01:00.000Z",
        },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Your Starter plan is live");
    expect(markup).not.toContain("Dodo is confirming the payment");
  });

  it("shows a safe cancelled checkout recovery state", async () => {
    mockReactRouterRender(
      billingRenderData({
        cancelledCheckout: true,
        selectedPlan: "starter",
        selectedCycle: "yearly",
        selectedSource: "pricing",
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Checkout was cancelled");
    expect(markup).toContain("a new monthly or annual checkout opens after Dodo confirms cancellation");
    expect(markup).toContain("/app/billing?plan=starter&amp;cycle=monthly&amp;source=pricing#plans");
    expect(markup).toContain("/app/billing?plan=starter&amp;cycle=yearly&amp;source=pricing#plans");
  });

  it("renders the unavailable annual checkout banner", async () => {
    mockReactRouterRender(
      billingRenderData({
        selectedPlan: "starter",
        annualCheckoutUnavailable: true,
        pricingPreview: {
          annualValidation: {
            starter: { planId: "starter", valid: false, reason: "amount_mismatch" },
          },
        },
      }),
    );

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Starter annual checkout is unavailable");
    expect(markup).toContain("does not validate as 4 months free");
  });

  it("renders the top-up requires paid plan banner", async () => {
    mockReactRouterRender(billingRenderData({ topUpRequiresPlan: true }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Top-up packs can only be added to a paid plan");
    expect(markup).toContain("Choose a plan first");
  });

  it("renders the unavailable top-up checkout banner", async () => {
    mockReactRouterRender(billingRenderData({ topUpCheckoutUnavailable: true }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("That top-up pack is temporarily unavailable");
    expect(markup).toContain("Your plan is unchanged");
  });

  it("renders the stale agency-held checkout fallback banner", async () => {
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
      agencyCheckoutHeld: true,
      planCheckoutUnavailable: false,
      portalUnavailable: false,
      hasPortal: false,
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Agency is available by account review");
    expect(markup).toContain("confirm fit directly");
    expect(markup).not.toContain("capacity review");
    expect(markup).not.toContain("higher-volume monitoring coverage");
    expect(markup).not.toContain("Agency checkout is not available from that checkout link");
    expect(markup).not.toContain("Scout and Starter are available now");
    expect(markup).not.toContain("need Agency capacity before then");
  });

  it("renders evidence usage with purchased top-up balance and grant rows", async () => {
    mockReactRouterRender({
      email: "owner@example.com",
      billing: {
        plan: "starter",
        dodoStatus: "succeeded",
        dodoProductId: "prod_starter_monthly",
        planUpdatedAt: "2026-06-04T12:00:00.000Z",
      },
      proofUsage: {
        used: 200,
        includedUsed: 200,
        baseLimit: 250,
        extraCredits: 500,
        limit: 750,
        remaining: 550,
        topUpRemaining: 500,
        usageRatio: 0.27,
        warningLevel: "ok",
        canSpendTopUps: true,
        topUpRetainedWhileInactive: 0,
      },
      watchlistUsage: { current: 3, limit: 10 },
      collectionUsage: { current: 5, limit: 25 },
      planLimits: { digestCadence: "weekly" },
      dailyProofCap: 40,
      creditGrants: [
        {
          skuSlug: "burst_500_v1",
          providerPaymentId: "pay_top_up",
          credits: 500,
          grantedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      blockedCheckout: false,
      pendingCheckout: false,
      agencyCheckoutHeld: false,
      planCheckoutUnavailable: false,
      portalUnavailable: false,
      hasPortal: true,
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("200 of 250 included used");
    expect(markup).toContain("500 purchased captures remaining");
    expect(markup).toContain("Proof Pack — 500");
    expect(markup).toContain("500 proof captures from Proof Pack — 500 — never expire");
    expect(markup).not.toContain("burst_500_v1");
    expect(markup).toContain("never expire");
  });

  it("presents the hosted billing portal with confident cancellation guidance", async () => {
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
      hasDodoSubscription: true,
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Open billing portal");
    expect(markup).toContain("card and invoice tasks");
    expect(markup).toContain("Cancel anytime — email");
    expect(markup).toContain("support@0509.io");
    expect(markup).toContain("confirm your cancellation request");
    expect(markup).not.toContain("confirm the same day");
    expect(markup).not.toContain("Cancel anytime from the billing portal");
    expect(markup).not.toContain("until portal cancellation is fully available");
    expect(markup).toContain("Use the plan cards above to switch plans");
    expect(markup).toContain("/app/support?category=billing");
    expect(markup).not.toContain("cancel — self-serve");
    expect(markup).not.toContain("100% customer satisfaction");
  });

  it("gives pre-preview loading placeholders accessible status text", async () => {
    mockReactRouterRender({
      ...billingRenderData(),
      pricingPreview: undefined,
    });

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain('class="f9-sr-only">Loading price</span>');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).not.toContain('aria-label="Loading price"');
  });

  it("treats missing SKUs as terminal when only part of the provider preview resolves", async () => {
    mockReactRouterRender(billingRenderData({
      pricingPreview: {
        available: true,
        prices: {
          scout: {
            monthly: { display: "$19" },
          },
        },
        usageBundles: {
          proof_500: { display: "$25" },
        },
      },
    }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("$19");
    expect(markup).toContain("$25");
    expect(markup.match(/Price didn’t load — we’re retrying\. Refresh in a moment\./g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(markup).not.toContain("Price unavailable");
    // A plan whose price did not load is not selectable in any form: no
    // checkout form, and no Select link that implies a priced SKU.
    const agencyCard = markup.split('f9-wk-plan-card').find((chunk) => chunk.includes("didn’t load"));
    expect(agencyCard).toBeDefined();
    expect(agencyCard).not.toContain(">Select<");
    expect(markup).not.toContain("f9-skeleton-price");
    expect(markup).not.toContain("Loading price");
    expect(markup).not.toContain('aria-busy="true"');
  });

  it("shows a terminal pricing error instead of permanent loading placeholders", async () => {
    mockReactRouterRender(billingRenderData({
      pricingPreview: {
        available: false,
        prices: {},
        annualValidation: {},
        usageBundles: {},
      },
    }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup.match(/Prices are temporarily unavailable — try again shortly/g)).toHaveLength(1);
    expect(markup).toContain("Price didn’t load — we’re retrying. Refresh in a moment.");
    expect(markup).not.toContain("Price unavailable");
    expect(markup).not.toContain("f9-skeleton-price");
    expect(markup).not.toContain("Loading price");
    expect(markup).not.toContain('aria-busy="true"');
  });

  it("puts the lifecycle summary before the plan picker and gives every plan a heading", async () => {
    mockReactRouterRender(billingRenderData({
      billing: {
        plan: "starter",
        dodoStatus: "subscription.active",
        billingInterval: "monthly",
        dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
      },
      hasPortal: true,
    }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup.indexOf('id="billing-lifecycle-heading"')).toBeGreaterThan(-1);
    expect(markup.indexOf('id="billing-lifecycle-heading"')).toBeLessThan(markup.indexOf('id="plans"'));
    expect(markup).toMatch(/<h3><span class="f9-wk-kick">Scout<\/span><\/h3>/);
    expect(markup).toMatch(/<h3><span class="f9-wk-kick">Starter<\/span><\/h3>/);
    expect(markup).toMatch(/<h3><span class="f9-wk-kick">Agency<\/span><\/h3>/);
  });

  it.each([
    ["refunded", "Refunded", "paid access has ended", "keep access until"],
    ["subscription.cancelled", "Subscription cancelled", "paid access has ended", "keep access until"],
    ["subscription.expired", "Subscription expired", "paid access has ended", "keep access until"],
  ])("keeps terminal %s states from promising paid-period access", async (status, label, expectedCopy, forbiddenCopy) => {
    vi.resetModules();
    mockReactRouterRender(billingRenderData({
      billing: { plan: "free", dodoStatus: status },
      hasPortal: false,
    }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain(`>${label}<`);
    expect(markup.toLowerCase()).toContain(expectedCopy);
    expect(markup.toLowerCase()).not.toContain(forbiddenCopy);
    expect(markup).toContain("Choose a plan");
  });

  it("states scheduled cancellation access precisely and avoids an unproven retry claim", async () => {
    mockReactRouterRender(billingRenderData({
      billing: {
        plan: "starter",
        dodoStatus: "cancellation_scheduled",
        billingInterval: "monthly",
        dodoNextBillingAt: "2026-08-04T12:00:00.000Z",
      },
      hasPortal: true,
    }));

    const { default: BillingRoute } = await import("~/routes/app.billing");
    const markup = renderToStaticMarkup(createElement(BillingRoute));

    expect(markup).toContain("Cancellation scheduled");
    expect(markup).toContain("paid access ends");
    expect(markup).not.toContain("payment retry in progress");
    expect(markup).not.toContain("payment provider retries");
  });
});
