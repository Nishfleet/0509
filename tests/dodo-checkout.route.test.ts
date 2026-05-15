import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}, country = "US") {
  return {
    cloudflare: {
      country,
      env,
    },
  };
}

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
  vi.doUnmock("~/lib/dodo.server");
});

describe("Dodo checkout route", () => {
  it("creates a hosted checkout for rest-of-world signed-in users", async () => {
    const createDodoCheckoutSession = vi.fn().mockResolvedValue({
      session_id: "cks_123",
      checkout_url: "https://checkout.dodopayments.com/session/cks_123",
    });
    const recordPendingDodoSubscription = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        APP_REGION_DEFAULT: "rest_of_world",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PAYMENTS_API_KEY: "dodo-key",
        DODO_0509_PAYMENTS_WEBHOOK_KEY: "webhook-secret",
        DODO_0509_PRODUCT_STARTER_MONTHLY: "prod_starter_monthly",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      getPricingRegionPreference: vi.fn().mockResolvedValue("rest_of_world"),
      recordPendingDodoSubscription,
    }));
    vi.doMock("~/lib/dodo.server", async () => {
      const actual = await vi.importActual<typeof import("~/lib/dodo.server")>("~/lib/dodo.server");
      return {
        ...actual,
        createDodoCheckoutSession,
      };
    });

    const formData = new FormData();
    formData.set("plan", "starter");
    formData.set("cycle", "monthly");

    const { action } = await import("~/routes/api.billing.dodo.checkout");
    await expect(
      action({
        context: createContext(),
        request: new Request("https://0509.in/api/billing/dodo/checkout", {
          method: "POST",
          body: formData,
        }),
      } as never),
    ).rejects.toMatchObject({
      status: 303,
    });

    expect(createDodoCheckoutSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        plan: "starter",
        cycle: "monthly",
        userId: "user-1",
        userEmail: "owner@example.com",
        returnUrl: "https://0509.in/app?billing=dodo",
      }),
    );
    expect(recordPendingDodoSubscription).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        checkoutSessionId: "cks_123",
        status: "checkout_created",
      }),
    );
  });

  it("rejects India users so Razorpay remains the India checkout lane", async () => {
    vi.doMock("~/lib/auth.server", () => ({
      requireSession: vi.fn().mockResolvedValue(session),
    }));
    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({})),
    }));
    vi.doMock("~/lib/data.server", () => ({
      recordPendingDodoSubscription: vi.fn(),
    }));

    const formData = new FormData();
    formData.set("plan", "starter");
    formData.set("cycle", "monthly");

    const { action } = await import("~/routes/api.billing.dodo.checkout");

    await expect(
      action({
        context: createContext({}, "IN"),
        request: new Request("https://0509.in/api/billing/dodo/checkout", {
          method: "POST",
          headers: {
            cookie: "pricing_region=rest_of_world",
          },
          body: formData,
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });
});
