import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createContext(env = {}) {
  return {
    cloudflare: {
      env,
    },
  };
}

function hmacBase64(message: string, secret: string) {
  return createHmac("sha256", secret).update(message).digest("base64");
}

function signedHeaders(rawBody: string, secret: string, webhookId = "wh_123") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1=${hmacBase64(`${webhookId}.${timestamp}.${rawBody}`, secret)}`,
  };
}

function webhookPayload() {
  return JSON.stringify({
    type: "subscription.active",
    timestamp: new Date().toISOString(),
    data: {
      payload_type: "Subscription",
      subscription_id: "sub_123",
      product_id: "prod_starter_monthly",
      status: "active",
      checkout_session_id: "cks_123",
      customer: {
        customer_id: "cust_123",
      },
      metadata: {
        user_id: "user-1",
        plan: "starter",
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

describe("Dodo webhook route", () => {
  it("uses webhook ids to ignore duplicate deliveries", async () => {
    const secret = "webhook-secret";
    const rawBody = webhookPayload();
    const claimDodoWebhookEvent = vi.fn().mockResolvedValue(false);
    const syncDodoSubscriptionStatus = vi.fn();
    const markDodoWebhookEventFinished = vi.fn();

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PAYMENTS_WEBHOOK_KEY: secret,
        DODO_0509_PRODUCT_STARTER_MONTHLY: "prod_starter_monthly",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimDodoWebhookEvent,
      markDodoWebhookEventFinished,
      syncDodoSubscriptionStatus,
    }));

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.in/api/webhooks/dodo", {
        method: "POST",
        headers: signedHeaders(rawBody, secret, "wh_header"),
        body: rawBody,
      }),
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: false,
      duplicate: true,
    });
    expect(claimDodoWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "wh_header",
        subscriptionId: "sub_123",
        userId: "user-1",
      }),
    );
    expect(syncDodoSubscriptionStatus).not.toHaveBeenCalled();
    expect(markDodoWebhookEventFinished).not.toHaveBeenCalled();
  });

  it("marks claimed webhook events as processed after plan sync succeeds", async () => {
    const secret = "webhook-secret";
    const rawBody = webhookPayload();
    const claimDodoWebhookEvent = vi.fn().mockResolvedValue(true);
    const syncDodoSubscriptionStatus = vi.fn().mockResolvedValue(undefined);
    const markDodoWebhookEventFinished = vi.fn().mockResolvedValue(undefined);

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PAYMENTS_WEBHOOK_KEY: secret,
        DODO_0509_PRODUCT_STARTER_MONTHLY: "prod_starter_monthly",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimDodoWebhookEvent,
      markDodoWebhookEventFinished,
      syncDodoSubscriptionStatus,
    }));

    const { action } = await import("~/routes/api.webhooks.dodo");
    const response = await action({
      context: createContext(),
      request: new Request("https://0509.in/api/webhooks/dodo", {
        method: "POST",
        headers: signedHeaders(rawBody, secret, "wh_header"),
        body: rawBody,
      }),
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: true,
      event: "subscription.active",
    });
    expect(syncDodoSubscriptionStatus).toHaveBeenCalledOnce();
    expect(markDodoWebhookEventFinished).toHaveBeenCalledWith(
      expect.anything(),
      "wh_header",
      {
        outcome: "processed",
        metadata: {
          plan: "starter",
          status: "active",
        },
      },
    );
  });

  it("rejects webhook product ids that do not match configured products", async () => {
    const secret = "webhook-secret";
    const rawBody = webhookPayload();
    const claimDodoWebhookEvent = vi.fn();

    vi.doMock("~/lib/context.server", () => ({
      getEnv: vi.fn(() => ({
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PAYMENTS_WEBHOOK_KEY: secret,
        DODO_0509_PRODUCT_STARTER_MONTHLY: "prod_different",
      })),
    }));
    vi.doMock("~/lib/data.server", () => ({
      claimDodoWebhookEvent,
      markDodoWebhookEventFinished: vi.fn(),
      syncDodoSubscriptionStatus: vi.fn(),
    }));

    const { action } = await import("~/routes/api.webhooks.dodo");

    await expect(
      action({
        context: createContext(),
        request: new Request("https://0509.in/api/webhooks/dodo", {
          method: "POST",
          headers: signedHeaders(rawBody, secret, "wh_header"),
          body: rawBody,
        }),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(claimDodoWebhookEvent).not.toHaveBeenCalled();
  });
});
