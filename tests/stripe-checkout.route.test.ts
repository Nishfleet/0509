import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env: Record<string, unknown> = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

async function expectRedirect(
  callback: () => Promise<unknown>,
  location: string,
) {
  try {
    await callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(302);
    expect((error as Response).headers.get("Location")).toBe(location);
    return;
  }

  throw new Error(`Expected redirect to ${location}`);
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

describe("stripe checkout route", () => {
  it("creates a checkout session and redirects to Stripe Checkout", async () => {
    const createCheckoutSession = vi.fn().mockResolvedValue({
      url: "https://checkout.stripe.com/pay/cs_test_123",
    });
    const resolveCheckoutPriceId = vi.fn().mockReturnValue("price_starter_monthly");

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/stripe.server", () => ({
      createStripeClient: vi.fn().mockReturnValue({
        checkout: {
          sessions: {
            create: createCheckoutSession,
          },
        },
      }),
      parseBillingInterval: vi.fn().mockImplementation((value) => value),
      parseBillingPlan: vi.fn().mockImplementation((value) => value),
      resolveCheckoutPriceId,
    }));

    const { action } = await import("~/routes/api.checkout");
    const formData = new FormData();
    formData.set("plan", "starter");
    formData.set("interval", "monthly");

    await expectRedirect(
      () =>
        action({
          context: createContext({
            STRIPE_SECRET_KEY: "sk_test_123",
            STRIPE_STARTER_PRICE_ID: "price_starter_monthly",
          }),
          request: new Request("http://localhost/api/checkout", {
            method: "POST",
            body: formData,
          }),
        } as never),
      "https://checkout.stripe.com/pay/cs_test_123",
    );

    expect(resolveCheckoutPriceId).toHaveBeenCalledWith(
      expect.objectContaining({
        STRIPE_STARTER_PRICE_ID: "price_starter_monthly",
      }),
      "starter",
      "monthly",
    );
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        client_reference_id: "user-1",
        customer_email: "owner@example.com",
        success_url: "http://localhost/app?upgraded=1",
        cancel_url: "http://localhost/#pricing",
        line_items: [
          {
            price: "price_starter_monthly",
            quantity: 1,
          },
        ],
        metadata: {
          interval: "monthly",
          plan: "starter",
        },
      }),
    );
  });
});

describe("app layout loader", () => {
  it("returns the current user plan for workspace chrome", async () => {
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

    expect(result).toMatchObject({
      plan: "free",
      session,
    });
  });
});
