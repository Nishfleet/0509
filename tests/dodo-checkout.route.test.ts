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
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
  vi.doUnmock("~/lib/dodo-billing.server");
  vi.doUnmock("~/lib/dodo-pricing.server");
  vi.doUnmock("~/lib/plan.server");
  vi.doUnmock("~/lib/rate-limit.server");
  vi.doUnmock("~/lib/workspace.server");
});

function mockCheckoutDependencies(
  currentPlan: string,
  options: {
    checkoutClaimed?: boolean;
    checkoutFails?: boolean;
    checkoutValid?: boolean;
    cleanupFails?: boolean;
    checkoutTargetFromSkuSlug?: (slug: string) => unknown;
    topUpValid?: boolean;
    sessionMissing?: boolean;
    sessionUser?: { id: string; email: string; name: string };
    resolveWorkspace?: (env: unknown, userId: string) => Promise<{
      workspaceUserId: string;
      isMember: boolean;
      ownerName: string | null;
    }>;
    workspace?: {
      workspaceUserId?: string;
      isMember?: boolean;
      ownerName?: string | null;
    };
  } = {},
) {
  const workspace = {
    workspaceUserId: options.workspace?.workspaceUserId ?? session.user.id,
    isMember: options.workspace?.isMember ?? false,
    ownerName: options.workspace?.ownerName ?? null,
  };
  const resolvedSession = options.sessionUser
    ? { ...session, user: { ...session.user, ...options.sessionUser } }
    : session;
  const createDodo0509CheckoutSession = vi.fn().mockResolvedValue({
    checkoutUrl: "https://checkout.dodo.example/session",
    sessionId: "sess_1",
  });
  if (options.checkoutFails) {
    createDodo0509CheckoutSession.mockRejectedValue(
      new Response("Dodo checkout failed.", { status: 502 }),
    );
  }
  const claimDodoPlanCheckout = vi.fn().mockResolvedValue(options.checkoutClaimed ?? true);
  const clearDodoPlanCheckout = vi.fn().mockResolvedValue(undefined);
  if (options.cleanupFails) {
    clearDodoPlanCheckout.mockRejectedValue(new Error("cleanup failed"));
  }
  const validateDodo0509PlanCheckout = vi.fn().mockResolvedValue({
    valid: options.checkoutValid ?? true,
    reason: options.checkoutValid === false ? "missing_monthly_price" : "valid_preview",
    planId: "starter",
    cycle: "monthly",
    price: null,
    pricingContext: { billingCountry: "US", billingCurrency: "USD" },
    annualValidation: null,
  });
  const validateDodo0509TopUpCheckout = vi.fn().mockResolvedValue({
    valid: options.topUpValid ?? true,
    reason: options.topUpValid === false ? "missing_bundle_price" : "valid_preview",
    sku: "burst_500_v1",
    bundleId: "proof_500",
    price: null,
    pricingContext: { billingCountry: "US", billingCurrency: "USD" },
  });
  vi.doMock("~/lib/auth.server", () => ({
    requireSession: options.sessionMissing
      ? vi.fn().mockRejectedValue(
          new Response(null, {
            status: 303,
            headers: {
              Location: "/auth/login?redirectTo=%2Fapi%2Fbilling%2Fdodo%2Fcheckout",
            },
          }),
        )
      : vi.fn().mockResolvedValue(resolvedSession),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session: resolvedSession,
      ...workspace,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({})),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue(currentPlan),
  }));
  // resolveWorkspace is keyed by user id in production. The explicit override
  // lets auth tests resolve a different workspace per caller, which is what
  // makes the ownership guard observable to an attacker-controlled session.
  vi.doMock("~/lib/workspace.server", () => ({
    resolveWorkspace: options.resolveWorkspace
      ? vi.fn(options.resolveWorkspace)
      : vi.fn().mockResolvedValue({
          ...workspace,
        }),
  }));
  vi.doMock("~/lib/dodo-billing.server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/dodo-billing.server")>();
    return {
      ...actual,
      ...(options.checkoutTargetFromSkuSlug
        ? { checkoutTargetFromSkuSlug: options.checkoutTargetFromSkuSlug }
        : {}),
      createDodo0509CheckoutSession,
    };
  });
  vi.doMock("~/lib/dodo-pricing.server", () => ({
    validateDodo0509PlanCheckout,
    validateDodo0509TopUpCheckout,
  }));
  vi.doMock("~/lib/data.server", () => ({
    claimDodoPlanCheckout,
    clearDodoPlanCheckout,
  }));
  return {
    createDodo0509CheckoutSession,
    claimDodoPlanCheckout,
    clearDodoPlanCheckout,
    validateDodo0509PlanCheckout,
    validateDodo0509TopUpCheckout,
  };
}

function checkoutRequest(body: Record<string, string>, headers: HeadersInit = {}) {
  return new Request("https://0509.io/api/billing/dodo/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...Object.fromEntries(new Headers(headers)),
    },
    body: new URLSearchParams(body).toString(),
  });
}

describe("Dodo checkout route", () => {
  it.each([
    ["an unknown SKU", { sku: "tampered_sku" }],
    ["a missing target", {}],
  ])("keeps %s as HTTP 400 for programmatic callers", async (_label, body) => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout } =
      mockCheckoutDependencies("free");
    const { action } = await import("~/routes/api.billing.dodo.checkout");

    const response = (await action({
      context: {},
      request: checkoutRequest(body, {
        Accept: "application/json",
        "Sec-Fetch-Mode": "cors",
      }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
    await expect(response.text()).resolves.toBe("Invalid Dodo checkout target.");
    expect(claimDodoPlanCheckout).not.toHaveBeenCalled();
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("does not let an HTML-accepting fetch follow an invalid target into a success page", async () => {
    mockCheckoutDependencies("free");
    const { action } = await import("~/routes/api.billing.dodo.checkout");

    const response = (await action({
      context: {},
      request: checkoutRequest({ sku: "tampered_sku" }, {
        Accept: "text/html",
        "Sec-Fetch-Mode": "cors",
      }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("rejects a resolver result with an unknown plan family as an invalid API target", async () => {
    mockCheckoutDependencies("free", {
      checkoutTargetFromSkuSlug: () => ({
        kind: "plan",
        sku: "starter_monthly_v1",
        planFamily: "enterprise",
        cycle: "monthly",
      }),
    });
    const { action } = await import("~/routes/api.billing.dodo.checkout");

    const response = (await action({
      context: {},
      request: checkoutRequest({ sku: "tampered_plan" }, {
        Accept: "application/json",
        "Sec-Fetch-Mode": "cors",
      }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response.status).toBe(400);
    expect(response.headers.get("Location")).toBeNull();
  });

  it.each([
    ["an unknown SKU", { sku: "tampered_sku" }],
    ["a missing target", {}],
  ])("redirects %s only for a full-document browser navigation", async (_label, body) => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout } =
      mockCheckoutDependencies("free");
    const { action } = await import("~/routes/api.billing.dodo.checkout");

    const response = (await action({
      context: {},
      request: checkoutRequest(body, {
        Accept: "text/html,application/xhtml+xml",
        "Sec-Fetch-Mode": "navigate",
      }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/app/billing?checkout=invalid-target");
    expect(claimDodoPlanCheckout).not.toHaveBeenCalled();
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
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

  it("blocks workspace members from opening owner billing checkout", async () => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout, validateDodo0509PlanCheckout } =
      mockCheckoutDependencies("free", {
        workspace: {
          workspaceUserId: "owner-1",
          isMember: true,
          ownerName: "Owner",
        },
      });

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    const response = (await action({
      context: {},
      request: checkoutRequest({ plan: "starter", cycle: "monthly" }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Only the workspace owner can manage billing.");
    expect(validateDodo0509PlanCheckout).not.toHaveBeenCalled();
    expect(claimDodoPlanCheckout).not.toHaveBeenCalled();
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("redirects a missing session to login before any checkout provider call", async () => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout, validateDodo0509PlanCheckout } =
      mockCheckoutDependencies("free", { sessionMissing: true });

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    const response = (await action({
      context: {},
      request: checkoutRequest({ plan: "starter", cycle: "monthly" }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/auth/login?redirectTo=%2Fapi%2Fbilling%2Fdodo%2Fcheckout",
    );
    expect(validateDodo0509PlanCheckout).not.toHaveBeenCalled();
    expect(claimDodoPlanCheckout).not.toHaveBeenCalled();
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-owner before any checkout provider call", async () => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout, validateDodo0509PlanCheckout } =
      mockCheckoutDependencies("free", {
        sessionUser: { id: "member-1", email: "member@example.com", name: "Member" },
        resolveWorkspace: vi.fn().mockImplementation(async (_env, userId: string) =>
          userId === "member-1"
            ? { workspaceUserId: "owner-1", isMember: true, ownerName: "Owner" }
            : { workspaceUserId: userId, isMember: false, ownerName: null },
        ),
      });

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    const response = (await action({
      context: {},
      request: checkoutRequest({ plan: "starter", cycle: "monthly" }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Only the workspace owner can manage billing.");
    expect(validateDodo0509PlanCheckout).not.toHaveBeenCalled();
    expect(claimDodoPlanCheckout).not.toHaveBeenCalled();
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("holds Agency checkout until fan-out proof is documented", async () => {
    const { createDodo0509CheckoutSession, validateDodo0509PlanCheckout } =
      mockCheckoutDependencies("free");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ plan: "agency", cycle: "monthly" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?checkout=agency-held",
      );
    }

    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
    expect(validateDodo0509PlanCheckout).not.toHaveBeenCalled();
  });

  it("lets a free user start a plan checkout", async () => {
    const { createDodo0509CheckoutSession, validateDodo0509PlanCheckout } =
      mockCheckoutDependencies("free");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ plan: "starter", cycle: "monthly", source: "pricing" }),
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
    expect(createDodo0509CheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutId: expect.any(String),
        source: "pricing",
        pricingContext: {
          billingCountry: "US",
          billingCurrency: "USD",
        },
      }),
    );
    expect(validateDodo0509PlanCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "starter",
        cycle: "monthly",
      }),
    );
  });

  it("lets a free user start annual checkout after fresh Dodo validation", async () => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout, validateDodo0509PlanCheckout } =
      mockCheckoutDependencies("free");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ plan: "starter", cycle: "yearly", source: "pricing" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "https://checkout.dodo.example/session",
      );
    }

    expect(validateDodo0509PlanCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: "starter",
        cycle: "yearly",
      }),
    );
    expect(claimDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      checkoutId: expect.any(String),
    });
    expect(createDodo0509CheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "pricing",
        target: expect.objectContaining({
          kind: "plan",
          planFamily: "starter",
          sku: "starter_annual_v1",
          cycle: "yearly",
        }),
      }),
    );
  });

  it("blocks monthly checkout before claiming a lock when Dodo preview is unavailable", async () => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout } = mockCheckoutDependencies(
      "free",
      { checkoutValid: false },
    );

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
        "/app/billing?checkout=plan-unavailable&plan=starter",
      );
    }

    expect(claimDodoPlanCheckout).not.toHaveBeenCalled();
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("blocks annual checkout before claiming a lock when savings validation fails", async () => {
    const {
      createDodo0509CheckoutSession,
      claimDodoPlanCheckout,
      validateDodo0509PlanCheckout,
    } = mockCheckoutDependencies("free");
    validateDodo0509PlanCheckout.mockResolvedValue({
      valid: false,
      reason: "amount_mismatch",
      planId: "starter",
      cycle: "yearly",
      price: null,
      pricingContext: { billingCountry: "US", billingCurrency: "USD" },
      annualValidation: {
        planId: "starter",
        valid: false,
        reason: "amount_mismatch",
      },
    });

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ plan: "starter", cycle: "yearly" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?checkout=annual-unavailable&plan=starter",
      );
    }

    expect(claimDodoPlanCheckout).not.toHaveBeenCalled();
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("lets a free user start scout checkout via canonical SKU", async () => {
    const { createDodo0509CheckoutSession } = mockCheckoutDependencies("free");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ sku: "scout_monthly_v1" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "https://checkout.dodo.example/session",
      );
    }

    expect(createDodo0509CheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutId: expect.any(String),
        target: expect.objectContaining({
          kind: "plan",
          planFamily: "scout",
          sku: "scout_monthly_v1",
        }),
      }),
    );
  });

  it("does not clear a still-payable plan checkout from the unsigned cancel return", async () => {
    const { clearDodoPlanCheckout } = mockCheckoutDependencies("free");

    const { loader } = await import("~/routes/api.billing.dodo.cancel");

    try {
      await loader({
        context: {},
        request: new Request(
          "https://0509.io/api/billing/dodo/cancel?checkout_id=checkout_123&plan=starter&cycle=yearly&source=pricing",
        ),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?checkout=cancelled&kind=plan&plan=starter&cycle=yearly&source=pricing#plans",
      );
    }

    expect(clearDodoPlanCheckout).not.toHaveBeenCalled();
  });

  it("does not let workspace members clear the owner's cancelled checkout lock", async () => {
    const { clearDodoPlanCheckout } = mockCheckoutDependencies("free", {
      workspace: {
        workspaceUserId: "owner-1",
        isMember: true,
        ownerName: "Owner",
      },
    });

    const { loader } = await import("~/routes/api.billing.dodo.cancel");

    await loader({
      context: {},
      request: new Request(
        "https://0509.io/api/billing/dodo/cancel?checkout_id=checkout_123&plan=starter&cycle=monthly",
      ),
      params: {},
    } as never).catch((response) => {
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?checkout=cancelled&kind=plan&plan=starter&cycle=monthly#plans",
      );
    });

    expect(clearDodoPlanCheckout).not.toHaveBeenCalled();
  });

  it("blocks a second pending Dodo plan checkout before opening another session", async () => {
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout } = mockCheckoutDependencies(
      "free",
      { checkoutClaimed: false },
    );

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

    expect(claimDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      checkoutId: expect.any(String),
    });
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

    expect(clearDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), "user-1", {
      checkoutId: expect.any(String),
    });
  });

  it("preserves the original Dodo failure when lock cleanup also fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { clearDodoPlanCheckout } = mockCheckoutDependencies("free", {
      checkoutFails: true,
      cleanupFails: true,
    });

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    const response = (await action({
      context: {},
      request: checkoutRequest({ plan: "starter", cycle: "monthly" }),
      params: {},
    } as never).catch((error) => error)) as Response;

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(502);
    await expect(response.text()).resolves.toBe("Dodo checkout failed.");
    expect(clearDodoPlanCheckout).toHaveBeenCalledWith(expect.anything(), "user-1", {
      checkoutId: expect.any(String),
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to clear pending Dodo checkout lock after checkout failure.",
      expect.any(Error),
    );
  });

  it("blocks a free user from buying top-up packs by direct POST", async () => {
    const { createDodo0509CheckoutSession, validateDodo0509TopUpCheckout } =
      mockCheckoutDependencies("free");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ sku: "burst_500_v1" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?checkout=top-up-requires-plan#plans",
      );
    }

    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
    expect(validateDodo0509TopUpCheckout).not.toHaveBeenCalled();
  });

  it("blocks paid top-up checkout before opening Dodo when the fresh preview is unavailable", async () => {
    const { createDodo0509CheckoutSession, validateDodo0509TopUpCheckout } =
      mockCheckoutDependencies("starter", { topUpValid: false });

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ sku: "burst_500_v1" }),
        params: {},
      } as never);
      throw new Error("expected redirect");
    } catch (response) {
      expect((response as Response).status).toBe(303);
      expect((response as Response).headers.get("Location")).toBe(
        "/app/billing?checkout=top-up-unavailable#top-ups",
      );
    }

    expect(validateDodo0509TopUpCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ sku: "burst_500_v1" }),
    );
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });

  it("still lets a subscriber buy usage bundles by canonical SKU", async () => {
    const { createDodo0509CheckoutSession, validateDodo0509TopUpCheckout } =
      mockCheckoutDependencies("starter");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    try {
      await action({
        context: {},
        request: checkoutRequest({ sku: "burst_500_v1" }),
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
    expect(validateDodo0509TopUpCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ sku: "burst_500_v1" }),
    );
    expect(createDodo0509CheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        pricingContext: {
          billingCountry: "US",
          billingCurrency: "USD",
        },
      }),
    );
  });

  it("keeps the legacy bundle field mapped to the canonical top-up SKU", async () => {
    const { createDodo0509CheckoutSession, validateDodo0509TopUpCheckout } =
      mockCheckoutDependencies("starter");

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

    expect(validateDodo0509TopUpCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ sku: "burst_500_v1" }),
    );
    expect(createDodo0509CheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({
          kind: "top_up",
          sku: "burst_500_v1",
        }),
      }),
    );
  });

  it("fails closed before any Dodo call when the provider budget is unavailable", async () => {
    const { createDodo0509CheckoutSession, validateDodo0509PlanCheckout } =
      mockCheckoutDependencies("free");
    enforceBillingProviderRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limit_unavailable" }), { status: 503 }),
    );
    const { action } = await import("~/routes/api.billing.dodo.checkout");
    const response = (await action({
      context: {},
      request: checkoutRequest({ plan: "starter", cycle: "monthly" }),
      params: {},
    } as never).catch((error) => error)) as Response;
    expect(response.status).toBe(503);
    expect(validateDodo0509PlanCheckout).not.toHaveBeenCalled();
    expect(createDodo0509CheckoutSession).not.toHaveBeenCalled();
  });
});
