import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const enforceBillingProviderRateLimit = vi.fn();

beforeEach(() => {
  vi.resetModules();
  enforceBillingProviderRateLimit.mockReset().mockResolvedValue(null);
  vi.doMock("~/lib/rate-limit.server", () => ({
    enforceBillingProviderRateLimit,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/auth.server");
  vi.doUnmock("~/lib/commercial-launch-gate.server");
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/dodo-billing.server");
  vi.doUnmock("~/lib/dodo-plan-change-reconciliation.server");
  vi.doUnmock("~/lib/dodo-pricing.server");
  vi.doUnmock("~/lib/rate-limit.server");
});

describe("Dodo plan change route", () => {
  it("previews an owner plan upgrade without applying it", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
    });

    const response = await postPlanChange("starter_monthly_v1");
    const params = billingSearchParams(response);

    expect(response.status).toBe(303);
    expect(params.get("plan-change")).toBe("preview");
    expect(params.get("plan")).toBe("starter");
    expect(params.get("cycle")).toBe("monthly");
    expect(params.get("sku")).toBe("starter_monthly_v1");
    expect(params.get("charge")).toBeNull();
    expect(params.get("effective")).toBe("immediately");
    expect(mocks.validateDodo0509PlanCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "starter", cycle: "monthly" }),
    );
    expect(mocks.previewDodo0509SubscriptionPlanChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub_123",
        target: expect.objectContaining({ sku: "starter_monthly_v1" }),
        userId: "user-1",
        effectiveAt: "immediately",
        prorationBillingMode: "prorated_immediately",
      }),
    );
    expect(mocks.getDodo0509SubscriptionCurrency).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub_123" }),
    );
    expect(mocks.summarizeDodoSubscriptionPlanChangePreview).toHaveBeenCalledWith(
      expect.any(Object),
      "INR",
    );
    expect(mocks.claimDodoSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("applies an owner plan upgrade only after explicit confirmation", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
    });

    const response = await postPlanChange("starter_monthly_v1", confirmFields());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/app/billing?plan-change=accepted&plan=starter&cycle=monthly#plans",
    );
      expect(mocks.claimDodoSubscriptionPlanChange).toHaveBeenCalledWith(
        expect.anything(),
        {
          userId: "user-1",
          status: "plan_change_pending",
          providerProductId: "prod_starter_monthly",
          currentSubscriptionId: "sub_123",
          currentProductId: "prod_123",
          currentStatus: "subscription.active",
          currentPlanUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
      );
    expect(mocks.changeDodo0509SubscriptionPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub_123",
        target: expect.objectContaining({ sku: "starter_monthly_v1" }),
        userId: "user-1",
        effectiveAt: "immediately",
        prorationBillingMode: "prorated_immediately",
      }),
    );
  });

  it("schedules downgrades for the next billing date without immediate billing", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "starter",
        billingInterval: "annual",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
    });

    const response = await postPlanChange("scout_monthly_v1", confirmFields());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/app/billing?plan-change=scheduled&plan=scout&cycle=monthly#plans",
    );
      expect(mocks.claimDodoSubscriptionPlanChange).toHaveBeenCalledWith(
        expect.anything(),
        {
          userId: "user-1",
          status: "plan_change_pending",
          providerProductId: "prod_scout_monthly",
          currentSubscriptionId: "sub_123",
          currentProductId: "prod_123",
          currentStatus: "subscription.active",
          currentPlanUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
      );
    expect(mocks.markDodoSubscriptionPlanChangeScheduled).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "user-1" },
    );
    expect(mocks.previewDodo0509SubscriptionPlanChange).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        effectiveAt: "next_billing_date",
        prorationBillingMode: "full_immediately",
      }),
    );
    expect(mocks.changeDodo0509SubscriptionPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        effectiveAt: "next_billing_date",
        prorationBillingMode: "full_immediately",
      }),
    );
  });

  it("blocks workspace members before reading billing or calling Dodo", async () => {
    const mocks = mockPlanChangeRoute({
      isMember: true,
      workspaceUserId: "owner-1",
    });

    const response = await postPlanChange("starter_monthly_v1");

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Only the workspace owner can manage billing.");
    expect(mocks.getUserPlanBillingInfo).not.toHaveBeenCalled();
    expect(mocks.previewDodo0509SubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("does not call Dodo for free accounts", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "free",
        billingInterval: null,
        dodoStatus: null,
        dodoSubscriptionId: null,
      },
    });

    const response = await postPlanChange("starter_monthly_v1");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/app/billing?plan-change=requires-subscription#plans",
    );
    expect(mocks.validateDodo0509PlanCheckout).not.toHaveBeenCalled();
    expect(mocks.previewDodo0509SubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("does not apply a change when Dodo preview fails", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
      previewRejects: true,
    });

    const response = await postPlanChange("starter_monthly_v1");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/billing?plan-change=unavailable#plans");
    expect(mocks.previewDodo0509SubscriptionPlanChange).toHaveBeenCalledTimes(1);
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("blocks repeated submissions while a plan change is pending", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "plan_change_pending",
        dodoSubscriptionId: "sub_123",
      },
    });

    const response = await postPlanChange("starter_monthly_v1", confirmFields());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/billing?plan-change=pending-change#plans");
    expect(mocks.previewDodo0509SubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.claimDodoSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("reconciles an expired ambiguous claim from current Dodo state without a second mutation", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "plan_change_pending",
        dodoSubscriptionId: "sub_123",
        dodoPlanChangeProductId: "prod_starter_monthly",
        planUpdatedAt: "2026-01-04T12:00:00.000Z",
      },
      reconciliationDue: true,
      reconciliationResult: { ok: true, outcome: "unchanged" },
    });

    const response = await postPlanChange("", { intent: "reconcile" });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/app/billing?plan-change=recovered#plans",
    );
    expect(mocks.reconcileDodo0509SubscriptionPlanChange).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectUserId: "user-1",
        actorUserId: "user-1",
      }),
    );
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("keeps provider-unknown claims fail-closed and does not issue a second mutation", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "plan_change_pending",
        dodoSubscriptionId: "sub_123",
        dodoPlanChangeProductId: "prod_starter_monthly",
        planUpdatedAt: "2026-01-04T12:00:00.000Z",
      },
      reconciliationDue: true,
      reconciliationResult: { ok: true, outcome: "unknown" },
    });

    const response = await postPlanChange("", { intent: "reconcile" });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/app/billing?plan-change=pending-change#plans",
    );
    expect(mocks.reconcileDodo0509SubscriptionPlanChange).toHaveBeenCalledTimes(1);
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("does not query Dodo before the ambiguity recovery window expires", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "plan_change_pending",
        dodoSubscriptionId: "sub_123",
        dodoPlanChangeProductId: "prod_starter_monthly",
      },
      reconciliationDue: false,
    });

    const response = await postPlanChange("", { intent: "reconcile" });

    expect(response.headers.get("Location")).toBe(
      "/app/billing?plan-change=pending-change#plans",
    );
    expect(mocks.reconcileDodo0509SubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("blocks repeated submissions after a matching payment grant until subscription confirmation", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "starter",
        billingInterval: "monthly",
        dodoStatus: "succeeded",
        dodoSubscriptionId: "sub_123",
        dodoPlanChangeProductId: "prod_starter_monthly",
      },
    });

    const response = await postPlanChange("scout_monthly_v1", confirmFields());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/billing?plan-change=pending-change#plans");
    expect(mocks.previewDodo0509SubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.claimDodoSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("blocks plan changes before preview when cancellation is already scheduled", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "cancellation_scheduled",
        dodoSubscriptionId: "sub_123",
      },
    });

    const response = await postPlanChange("starter_monthly_v1");

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/app/billing?plan-change=cancellation-scheduled#plans",
    );
    expect(mocks.validateDodo0509PlanCheckout).not.toHaveBeenCalled();
    expect(mocks.previewDodo0509SubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.claimDodoSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("keeps the local plan-change guard when the provider mutation result is ambiguous", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
      changeRejects: "ambiguous",
    });

    const response = await postPlanChange("starter_monthly_v1", confirmFields());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/billing?plan-change=pending-change#plans");
      expect(mocks.claimDodoSubscriptionPlanChange).toHaveBeenCalledWith(
        expect.anything(),
        {
          userId: "user-1",
          status: "plan_change_pending",
          providerProductId: "prod_starter_monthly",
          currentSubscriptionId: "sub_123",
          currentProductId: "prod_123",
          currentStatus: "subscription.active",
          currentPlanUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
      );
    expect(mocks.clearDodoSubscriptionPlanChangeClaim).not.toHaveBeenCalled();
  });

  it("does not promote ambiguous scheduled downgrades to permanent scheduled locks", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "starter",
        billingInterval: "annual",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
      changeRejects: "ambiguous",
    });

    const response = await postPlanChange("scout_monthly_v1", confirmFields());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/billing?plan-change=pending-change#plans");
      expect(mocks.claimDodoSubscriptionPlanChange).toHaveBeenCalledWith(
        expect.anything(),
        {
          userId: "user-1",
          status: "plan_change_pending",
          providerProductId: "prod_scout_monthly",
          currentSubscriptionId: "sub_123",
          currentProductId: "prod_123",
          currentStatus: "subscription.active",
          currentPlanUpdatedAt: "2026-06-04T12:00:00.000Z",
        },
      );
    expect(mocks.markDodoSubscriptionPlanChangeScheduled).not.toHaveBeenCalled();
    expect(mocks.clearDodoSubscriptionPlanChangeClaim).not.toHaveBeenCalled();
  });

  it("clears the local plan-change guard when Dodo definitively rejects the mutation", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
      changeRejects: "definite",
    });

    const response = await postPlanChange("starter_monthly_v1", confirmFields());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/billing?plan-change=unavailable#plans");
    expect(mocks.clearDodoSubscriptionPlanChangeClaim).toHaveBeenCalledWith(
      expect.anything(),
      {
        userId: "user-1",
          claimedStatus: "plan_change_pending",
          previousStatus: "subscription.active",
          previousPlanUpdatedAt: "2026-06-04T12:00:00.000Z",
          providerProductId: "prod_starter_monthly",
          subscriptionId: "sub_123",
          claimedAt: "2026-06-04T12:01:00.000Z",
        },
      );
  });

  it("requires confirmation to match the server preview before changing the plan", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
      tokenMatches: false,
    });

    const response = await postPlanChange("starter_monthly_v1", confirmFields());

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/app/billing?plan-change=preview&plan=starter&cycle=monthly&sku=starter_monthly_v1&effective=immediately#plans",
    );
    expect(mocks.verifyDodoSubscriptionPlanChangePreviewToken).toHaveBeenCalledWith(
      expect.anything(),
      "preview_token_123",
      expect.objectContaining({
        subscriptionId: "sub_123",
        amount: 1234,
        currency: "INR",
      }),
    );
    expect(mocks.claimDodoSubscriptionPlanChange).not.toHaveBeenCalled();
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
  });

  it("blocks both preview provider calls when the pricing budget is exhausted", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
    });
    enforceBillingProviderRateLimit
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }));

    const response = await postPlanChange("starter_monthly_v1");
    expect(response.status).toBe(429);
    expect(mocks.getDodo0509SubscriptionCurrency).not.toHaveBeenCalled();
    expect(mocks.previewDodo0509SubscriptionPlanChange).not.toHaveBeenCalled();
  });

  it("blocks the provider mutation when confirmation spend is capped", async () => {
    const mocks = mockPlanChangeRoute({
      billing: {
        plan: "scout",
        billingInterval: "monthly",
        dodoStatus: "subscription.active",
        dodoSubscriptionId: "sub_123",
      },
    });
    enforceBillingProviderRateLimit
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 }));

    const response = await postPlanChange("starter_monthly_v1", confirmFields());
    expect(response.status).toBe(429);
    expect(mocks.changeDodo0509SubscriptionPlan).not.toHaveBeenCalled();
    expect(mocks.claimDodoSubscriptionPlanChange).not.toHaveBeenCalled();
  });
});

function mockPlanChangeRoute({
  billing = {
    plan: "starter",
    billingInterval: "monthly",
    dodoStatus: "subscription.active",
    dodoSubscriptionId: "sub_123",
  },
  isMember = false,
  workspaceUserId = session.user.id,
  previewRejects = false,
  changeRejects = false,
  claimSucceeds = true,
  tokenMatches = true,
  reconciliationDue = false,
  reconciliationResult = { ok: true, outcome: "unknown" },
}: {
  billing?: {
    plan: "free" | "scout" | "starter" | "agency";
    billingInterval: "monthly" | "annual" | null;
    dodoStatus: string | null;
    dodoSubscriptionId: string | null;
    dodoPlanChangeProductId?: string | null;
    planUpdatedAt?: string | null;
  };
  isMember?: boolean;
  workspaceUserId?: string;
  previewRejects?: boolean;
  changeRejects?: false | "ambiguous" | "definite";
  claimSucceeds?: boolean;
  tokenMatches?: boolean;
  reconciliationDue?: boolean;
  reconciliationResult?: { ok: boolean; outcome?: "accepted" | "scheduled" | "unchanged" | "unknown"; reason?: string };
} = {}) {
  vi.doMock("~/lib/auth.server", () => ({
    requireWorkspaceSession: vi.fn().mockResolvedValue({
      session,
      workspaceUserId,
      isMember,
      ownerName: null,
    }),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_annual",
      DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
      DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_annual",
    })),
  }));
  const getUserPlanBillingInfo = vi.fn().mockResolvedValue({
    dodoCustomerId: "cus_123",
    dodoProductId: "prod_123",
    dodoPlanChangeProductId: null,
    dodoNextBillingAt: "2026-07-04T12:00:00.000Z",
    planUpdatedAt: "2026-06-04T12:00:00.000Z",
    ...billing,
  });
    const claimDodoSubscriptionPlanChange = vi
      .fn()
      .mockResolvedValue(claimSucceeds ? { claimedAt: "2026-06-04T12:01:00.000Z" } : null);
  const clearDodoSubscriptionPlanChangeClaim = vi.fn().mockResolvedValue(true);
  const markDodoSubscriptionPlanChangeScheduled = vi.fn().mockResolvedValue(true);
  const isDodoSubscriptionPlanChangeReconciliationDue = vi.fn(() => reconciliationDue);
  vi.doMock("~/lib/data.server", () => ({
    DODO_SUBSCRIPTION_PLAN_CHANGE_PENDING_STATUS: "plan_change_pending",
    DODO_SUBSCRIPTION_PLAN_CHANGE_SCHEDULED_STATUS: "plan_change_scheduled",
    claimDodoSubscriptionPlanChange,
    clearDodoSubscriptionPlanChangeClaim,
    getUserPlanBillingInfo,
    isBlockingDodoSubscriptionPlanChangeStatus: vi.fn((
      status: string | null,
      _planUpdatedAt: string | null,
      planChangeProductId?: string | null,
    ) =>
      Boolean(planChangeProductId) ||
      status === "plan_change_scheduled" ||
      status === "plan_change_pending"
    ),
    isDodoSubscriptionPlanChangeReconciliationDue,
    markDodoSubscriptionPlanChangeScheduled,
  }));
  vi.doMock("~/lib/commercial-launch-gate.server", () => ({
    isPlanCheckoutAllowed: vi.fn((_: unknown, plan: string) => plan === "scout" || plan === "starter"),
  }));
  const validateDodo0509PlanCheckout = vi.fn().mockResolvedValue({
    valid: true,
    price: { currency: "INR" },
    pricingContext: {
      billingCountry: "IN",
      billingCurrency: "INR",
    },
  });
  vi.doMock("~/lib/dodo-pricing.server", () => ({ validateDodo0509PlanCheckout }));
  const previewDodo0509SubscriptionPlanChange = previewRejects
    ? vi.fn().mockRejectedValue(new Response("unavailable", { status: 502 }))
    : vi.fn().mockResolvedValue({
        immediate_charge: {
          summary: {
            total_amount: 1234,
            settlement_amount: 1234,
          },
        },
      });
  const rejectedChange = new Error("Dodo rejected plan change") as Error & { definite?: boolean };
  rejectedChange.definite = changeRejects === "definite";
  const changeDodo0509SubscriptionPlan = changeRejects
    ? vi.fn().mockRejectedValue(rejectedChange)
    : vi.fn().mockResolvedValue({ id: "sub_123" });
  const isDefiniteDodoSubscriptionPlanChangeRejection = vi.fn(
    (error: unknown) => Boolean((error as { definite?: boolean } | null)?.definite),
  );
  const summarizeDodoSubscriptionPlanChangePreview = vi.fn(() => ({
    amount: 1234,
    currency: "INR",
    display: "₹12.34",
  }));
  const getDodo0509SubscriptionCurrency = vi.fn().mockResolvedValue("INR");
  const verifyDodoSubscriptionPlanChangePreviewToken = vi.fn().mockResolvedValue(tokenMatches);
  vi.doMock("~/lib/dodo-billing.server", () => ({
    checkoutTargetFromSkuSlug: vi.fn((sku: string) => planTargetForSku(sku)),
    getDodo0509SubscriptionCurrency,
    isDefiniteDodoSubscriptionPlanChangeRejection,
    previewDodo0509SubscriptionPlanChange,
    summarizeDodoSubscriptionPlanChangePreview,
    verifyDodoSubscriptionPlanChangePreviewToken,
    changeDodo0509SubscriptionPlan,
  }));
  const reconcileDodo0509SubscriptionPlanChange = vi.fn().mockResolvedValue(reconciliationResult);
  vi.doMock("~/lib/dodo-plan-change-reconciliation.server", () => ({
    reconcileDodo0509SubscriptionPlanChange,
  }));

  return {
    getUserPlanBillingInfo,
    claimDodoSubscriptionPlanChange,
    clearDodoSubscriptionPlanChangeClaim,
    markDodoSubscriptionPlanChangeScheduled,
    validateDodo0509PlanCheckout,
    getDodo0509SubscriptionCurrency,
    previewDodo0509SubscriptionPlanChange,
    summarizeDodoSubscriptionPlanChangePreview,
    verifyDodoSubscriptionPlanChangePreviewToken,
    changeDodo0509SubscriptionPlan,
    isDodoSubscriptionPlanChangeReconciliationDue,
    reconcileDodo0509SubscriptionPlanChange,
  };
}

function confirmFields(fields: Record<string, string> = {}) {
  return { intent: "confirm", preview_token: "preview_token_123", ...fields };
}

async function postPlanChange(sku: string, fields: Record<string, string> = {}) {
  const { action } = await import("~/routes/api.billing.dodo.plan-change");
  return (await action({
    context: {},
    request: new Request("https://0509.io/api/billing/dodo/plan-change", {
      method: "POST",
      body: new URLSearchParams({ sku, ...fields }),
    }),
    params: {},
  } as never).catch((error) => error)) as Response;
}

function billingSearchParams(response: Response) {
  const location = response.headers.get("Location") ?? "";
  const [path] = location.split("#");
  return new URL(path, "https://0509.io").searchParams;
}

function planTargetForSku(sku: string) {
  switch (sku) {
    case "scout_monthly_v1":
      return { kind: "plan", sku, planFamily: "scout", cycle: "monthly" };
    case "scout_annual_v1":
      return { kind: "plan", sku, planFamily: "scout", cycle: "yearly" };
    case "starter_monthly_v1":
      return { kind: "plan", sku, planFamily: "starter", cycle: "monthly" };
    case "starter_annual_v1":
      return { kind: "plan", sku, planFamily: "starter", cycle: "yearly" };
    default:
      return null;
  }
}
