import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createRazorpaySubscription,
  fingerprintRazorpayWebhookBody,
  isRazorpayWebhookFresh,
  isRazorpaySubscriptionCheckoutConfigured,
  parseRazorpaySubscriptionWebhook,
  verifyRazorpaySubscriptionSignature,
  verifyRazorpayWebhookSignature,
} from "~/lib/razorpay.server";

function hmac(message: string, secret: string) {
  return createHmac("sha256", secret).update(message).digest("hex");
}

describe("Razorpay subscription billing", () => {
  it("requires keys and a configured subscription plan", () => {
    expect(isRazorpaySubscriptionCheckoutConfigured({})).toBe(false);
    expect(
      isRazorpaySubscriptionCheckoutConfigured({
        RAZORPAY_KEY_ID: "rzp_test_key",
        RAZORPAY_KEY_SECRET: "secret",
        RAZORPAY_PLAN_STARTER_MONTHLY: "plan_starter_monthly",
      }),
    ).toBe(true);
  });

  it("creates a Razorpay subscription link without exposing the key secret in the body", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "sub_123",
          status: "created",
          short_url: "https://rzp.io/i/sub_123",
          customer_id: null,
          plan_id: "plan_starter_monthly",
        }),
        { status: 200 },
      ),
    );

    const subscription = await createRazorpaySubscription(
      {
        RAZORPAY_KEY_ID: "rzp_test_key",
        RAZORPAY_KEY_SECRET: "super-secret",
        RAZORPAY_PLAN_STARTER_MONTHLY: "plan_starter_monthly",
      },
      {
        plan: "starter",
        cycle: "monthly",
        userId: "user-1",
        userEmail: "owner@example.com",
      },
      fetcher,
    );

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(fetcher).toHaveBeenCalledWith("https://api.razorpay.com/v1/subscriptions", expect.any(Object));
    expect(request.headers).toMatchObject({
      authorization: `Basic ${btoa("rzp_test_key:super-secret")}`,
      "content-type": "application/json",
    });
    expect(body).toMatchObject({
      plan_id: "plan_starter_monthly",
      total_count: 120,
      quantity: 1,
      customer_notify: false,
      notes: {
        product: "five_to_nine",
        source: "0509_web",
        user_id: "user-1",
        user_email: "owner@example.com",
        plan: "starter",
        cycle: "monthly",
      },
    });
    expect(JSON.stringify(body)).not.toContain("super-secret");
    expect(subscription.short_url).toBe("https://rzp.io/i/sub_123");
  });

  it("verifies the checkout subscription signature", async () => {
    const secret = "key-secret";
    const paymentId = "pay_123";
    const subscriptionId = "sub_123";
    const signature = hmac(`${paymentId}|${subscriptionId}`, secret);

    await expect(
      verifyRazorpaySubscriptionSignature({
        paymentId,
        subscriptionId,
        signature,
        keySecret: secret,
      }),
    ).resolves.toBe(true);
  });

  it("verifies webhooks against the raw body", async () => {
    const rawBody = JSON.stringify({ event: "subscription.activated" });
    const secret = "webhook-secret";

    await expect(
      verifyRazorpayWebhookSignature({
        rawBody,
        signature: hmac(rawBody, secret),
        webhookSecret: secret,
      }),
    ).resolves.toBeUndefined();
  });

  it("extracts the user and plan from subscription webhook notes", () => {
    const update = parseRazorpaySubscriptionWebhook({
      id: "evt_123",
      event: "subscription.activated",
      created_at: 1_777_777_000,
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

    expect(update).toMatchObject({
      eventId: "evt_123",
      event: "subscription.activated",
      payloadCreatedAt: "2026-05-03T02:56:40.000Z",
      userId: "user-1",
      plan: "starter",
      status: "active",
      subscriptionId: "sub_123",
      customerId: "cust_123",
      providerPlanId: "plan_starter_monthly",
      shouldGrant: true,
      shouldRevoke: false,
    });
  });

  it("fingerprints webhook bodies when Razorpay does not provide an event id", async () => {
    await expect(fingerprintRazorpayWebhookBody(JSON.stringify({ event: "subscription.activated" })))
      .resolves.toMatch(/^body_sha256:[a-f0-9]{64}$/);
  });

  it("treats Razorpay webhook events outside the retry window as stale", () => {
    const now = Date.parse("2026-05-15T12:00:00.000Z");

    expect(isRazorpayWebhookFresh("2026-05-15T11:00:00.000Z", now)).toBe(true);
    expect(isRazorpayWebhookFresh("2026-05-14T09:00:00.000Z", now)).toBe(false);
    expect(isRazorpayWebhookFresh("2026-05-15T12:10:01.000Z", now)).toBe(false);
  });
});
