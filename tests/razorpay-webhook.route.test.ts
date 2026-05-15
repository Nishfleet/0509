import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function hmac(message: string, secret: string) {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function webhookPayload() {
  return JSON.stringify({
    id: "evt_body",
    event: "subscription.activated",
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      subscription: {
        entity: {
          id: "sub_123",
          customer_id: "cust_123",
          plan_id: "plan_starter_monthly",
          status: "active",
          notes: {
            user_id: "user-1",
            plan: "starter",
          },
        },
      },
    },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("~/lib/context.server");
  vi.doUnmock("~/lib/data.server");
});

describe("Razorpay webhook route", () => {
  it("uses Razorpay event ids to ignore duplicate deliveries", async () => {
    const secret = "webhook-secret";
    const rawBody = webhookPayload();
    const claimRazorpayWebhookEvent = vi.fn().mockResolvedValue(false);
    const syncRazorpaySubscriptionStatus = vi.fn();
    const markRazorpayWebhookEventFinished = vi.fn();

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        RAZORPAY_WEBHOOK_SECRET: secret,
        RAZORPAY_PLAN_STARTER_MONTHLY: "plan_starter_monthly",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimRazorpayWebhookEvent,
      markRazorpayWebhookEventFinished,
      syncRazorpaySubscriptionStatus,
    }));

    const { action } = await import("~/routes/api.webhooks.razorpay");
    const response = await action({
      context: createContext({ RAZORPAY_WEBHOOK_SECRET: secret }),
      request: new Request("https://0509.in/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "x-razorpay-signature": hmac(rawBody, secret),
          "x-razorpay-event-id": "evt_header",
        },
        body: rawBody,
      }),
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: false,
      duplicate: true,
    });
    expect(claimRazorpayWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "evt_header",
        subscriptionId: "sub_123",
        userId: "user-1",
      }),
    );
    expect(syncRazorpaySubscriptionStatus).not.toHaveBeenCalled();
    expect(markRazorpayWebhookEventFinished).not.toHaveBeenCalled();
  });

  it("marks claimed webhook events as processed after plan sync succeeds", async () => {
    const secret = "webhook-secret";
    const rawBody = webhookPayload();
    const claimRazorpayWebhookEvent = vi.fn().mockResolvedValue(true);
    const syncRazorpaySubscriptionStatus = vi.fn().mockResolvedValue(undefined);
    const markRazorpayWebhookEventFinished = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        RAZORPAY_WEBHOOK_SECRET: secret,
        RAZORPAY_PLAN_STARTER_MONTHLY: "plan_starter_monthly",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimRazorpayWebhookEvent,
      markRazorpayWebhookEventFinished,
      syncRazorpaySubscriptionStatus,
    }));

    const { action } = await import("~/routes/api.webhooks.razorpay");
    const response = await action({
      context: createContext({ RAZORPAY_WEBHOOK_SECRET: secret }),
      request: new Request("https://0509.in/api/webhooks/razorpay", {
        method: "POST",
        headers: {
          "x-razorpay-signature": hmac(rawBody, secret),
          "x-razorpay-event-id": "evt_header",
        },
        body: rawBody,
      }),
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: true,
      event: "subscription.activated",
    });
    expect(syncRazorpaySubscriptionStatus).toHaveBeenCalledOnce();
    expect(markRazorpayWebhookEventFinished).toHaveBeenCalledWith(
      expect.anything(),
      "evt_header",
      {
        outcome: "processed",
        metadata: {
          plan: "starter",
          status: "active",
        },
      },
    );
  });

  it("rejects webhook plan ids that do not match configured plans", async () => {
    const secret = "webhook-secret";
    const rawBody = webhookPayload();
    const claimRazorpayWebhookEvent = vi.fn();

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        RAZORPAY_WEBHOOK_SECRET: secret,
        RAZORPAY_PLAN_STARTER_MONTHLY: "plan_different",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimRazorpayWebhookEvent,
      markRazorpayWebhookEventFinished: vi.fn(),
      syncRazorpaySubscriptionStatus: vi.fn(),
    }));

    const { action } = await import("~/routes/api.webhooks.razorpay");

    await expect(
      action({
        context: createContext({
          RAZORPAY_WEBHOOK_SECRET: secret,
          RAZORPAY_PLAN_STARTER_MONTHLY: "plan_different",
        }),
        request: new Request("https://0509.in/api/webhooks/razorpay", {
          method: "POST",
          headers: {
            "x-razorpay-signature": hmac(rawBody, secret),
            "x-razorpay-event-id": "evt_header",
          },
          body: rawBody,
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(claimRazorpayWebhookEvent).not.toHaveBeenCalled();
  });
});
