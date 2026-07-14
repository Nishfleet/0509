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

beforeEach(() => {
  vi.resetModules();
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
  vi.doUnmock("~/lib/workspace.server");
});

function mockCheckoutDependencies(
  currentPlan: string,
  options: {
    checkoutClaimed?: boolean;
    checkoutFails?: boolean;
    checkoutValid?: boolean;
    cleanupFails?: boolean;
    topUpValid?: boolean;
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
    requireSession: vi.fn().mockResolvedValue(session),
    requireWorkspaceSession: vi.fn().mockImplementation(async () => ({
      session,
      ...workspace,
    })),
  }));
  vi.doMock("~/lib/context.server", () => ({
    getEnv: vi.fn(() => ({})),
  }));
  vi.doMock("~/lib/plan.server", () => ({
    getUserPlan: vi.fn().mockResolvedValue(currentPlan),
  }));
  vi.doMock("~/lib/workspace.server", () => ({
    resolveWorkspace: vi.fn().mockResolvedValue({
      ...workspace,
    }),
  }));
  vi.doMock("~/lib/dodo-billing.server", async (importOriginal) => {
    const actual = await importOriginal<typeof import("~/lib/dodo-billing.server")>();
    return {
      ...actual,
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

function checkoutRequest(body: Record<string, string>) {
  return new Request("https://0509.io/api/billing/dodo/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

describe("Dodo checkout route", () => {
	it.each([
		["an unknown SKU", { sku: "tampered_sku" }],
		["a missing target", {}],
	])("redirects %s back to billing with an inline-safe notice", async (_label, body) => {
		const { createDodo0509CheckoutSession, claimDodoPlanCheckout } =
			mockCheckoutDependencies("free");
		const { action } = await import("~/routes/api.billing.dodo.checkout");

		const response = (await action({
			context: {},
			request: checkoutRequest(body),
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
    const validateDodo0509PlanCheckout = vi.fn().mockResolvedValue({
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
    const { createDodo0509CheckoutSession, claimDodoPlanCheckout } =
      mockCheckoutDependencies("free");
    vi.doMock("~/lib/dodo-pricing.server", () => ({
      validateDodo0509PlanCheckout,
      validateDodo0509TopUpCheckout: vi.fn(),
    }));

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
});
