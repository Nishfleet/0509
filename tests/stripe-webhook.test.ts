import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env: Record<string, unknown> = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("stripe webhook route", () => {
  it("upserts the user plan after checkout completes", async () => {
    const upsertUserPlan = vi.fn().mockResolvedValue(undefined);
    const downgradeUserPlan = vi.fn().mockResolvedValue(undefined);
    const constructEventAsync = vi.fn().mockResolvedValue({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "user-1",
          customer: "cus_123",
          subscription: "sub_123",
          metadata: {
            plan: "starter",
          },
        },
      },
    });

    vi.doMock("~/lib/plan.server", () => ({
      downgradeUserPlan,
      upsertUserPlan,
    }));
    vi.doMock("~/lib/stripe.server", () => ({
      createStripeClient: vi.fn().mockReturnValue({
        webhooks: {
          constructEventAsync,
        },
      }),
      getStripeObjectId: vi.fn().mockImplementation((value) => value),
      parseBillingPlan: vi.fn().mockImplementation((value) => value),
    }));

    const { action } = await import("~/routes/api.webhooks.stripe");
    const response = await action({
      context: createContext({
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
      }),
      request: new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "stripe-signature": "sig_123",
        },
        body: "{}",
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(upsertUserPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
      }),
      {
        plan: "starter",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        userId: "user-1",
      },
    );
    expect(downgradeUserPlan).not.toHaveBeenCalled();
  });

  it("returns 400 when the Stripe signature is invalid", async () => {
    const constructEventAsync = vi.fn().mockRejectedValue(new Error("bad signature"));

    vi.doMock("~/lib/plan.server", () => ({
      downgradeUserPlan: vi.fn(),
      upsertUserPlan: vi.fn(),
    }));
    vi.doMock("~/lib/stripe.server", () => ({
      createStripeClient: vi.fn().mockReturnValue({
        webhooks: {
          constructEventAsync,
        },
      }),
      getStripeObjectId: vi.fn().mockImplementation((value) => value),
      parseBillingPlan: vi.fn().mockImplementation((value) => value),
    }));

    const { action } = await import("~/routes/api.webhooks.stripe");
    const response = await action({
      context: createContext({
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
      }),
      request: new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "stripe-signature": "sig_123",
        },
        body: "{}",
      }),
    } as never);

    expect(response.status).toBe(400);
  });

  it("downgrades the user plan when a subscription is deleted", async () => {
    const upsertUserPlan = vi.fn().mockResolvedValue(undefined);
    const downgradeUserPlan = vi.fn().mockResolvedValue(undefined);
    const constructEventAsync = vi.fn().mockResolvedValue({
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_123",
        },
      },
    });

    vi.doMock("~/lib/plan.server", () => ({
      downgradeUserPlan,
      upsertUserPlan,
    }));
    vi.doMock("~/lib/stripe.server", () => ({
      createStripeClient: vi.fn().mockReturnValue({
        webhooks: {
          constructEventAsync,
        },
      }),
      getStripeObjectId: vi.fn().mockImplementation((value) => value),
      parseBillingPlan: vi.fn().mockImplementation((value) => value),
    }));

    const { action } = await import("~/routes/api.webhooks.stripe");
    const response = await action({
      context: createContext({
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
      }),
      request: new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "stripe-signature": "sig_123",
        },
        body: "{}",
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(downgradeUserPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
      }),
      "sub_123",
    );
    expect(upsertUserPlan).not.toHaveBeenCalled();
  });
});
