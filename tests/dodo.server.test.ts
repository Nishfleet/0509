import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createDodoCheckoutSession,
  dodoCheckoutSessionId,
  dodoCheckoutUrl,
  isDodoCheckoutConfigured,
  isDodoWebhookProductAllowed,
  parseDodoSubscriptionWebhook,
  resolveDodoPlanFromProductId,
  verifyDodoWebhookSignature,
} from "~/lib/dodo.server";

function hmacBase64(message: string, secret: string) {
  return createHmac("sha256", secret).update(message).digest("base64");
}

describe("Dodo international billing", () => {
  it("requires an API key and a configured product", () => {
    expect(isDodoCheckoutConfigured({})).toBe(false);
    expect(
      isDodoCheckoutConfigured({
        DODO_PAYMENTS_API_KEY: "shared-dodo-key",
        DODO_PRODUCT_STARTER_MONTHLY: "prod_ai_converter",
      } as never),
    ).toBe(false);
    expect(
      isDodoCheckoutConfigured({
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PAYMENTS_API_KEY: "dodo_test_key",
        DODO_0509_PAYMENTS_WEBHOOK_KEY: "webhook-secret",
        DODO_0509_PRODUCT_STARTER_MONTHLY: "prod_starter_monthly",
      }),
    ).toBe(true);
  });

  it("creates a Dodo checkout session without exposing the API key in the body", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: "cks_123",
          checkout_url: "https://checkout.dodopayments.com/session/cks_123",
        }),
        { status: 200 },
      ),
    );

    const session = await createDodoCheckoutSession(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "live",
        DODO_0509_PAYMENTS_API_KEY: "dodo-secret",
        DODO_0509_PAYMENTS_WEBHOOK_KEY: "webhook-secret",
        DODO_0509_PRODUCT_STARTER_MONTHLY: "prod_starter_monthly",
      },
      {
        plan: "starter",
        cycle: "monthly",
        userId: "user-1",
        userEmail: "owner@example.com",
        userName: "Owner",
        returnUrl: "https://0509.in/app?billing=dodo",
      },
      fetcher,
    );

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(fetcher).toHaveBeenCalledWith("https://live.dodopayments.com/checkouts", expect.any(Object));
    expect(request.headers).toMatchObject({
      authorization: "Bearer dodo-secret",
      "content-type": "application/json",
    });
    expect(body).toMatchObject({
      product_cart: [{ product_id: "prod_starter_monthly", quantity: 1 }],
      customer: {
        email: "owner@example.com",
        name: "Owner",
      },
      return_url: "https://0509.in/app?billing=dodo",
      metadata: {
        brand_id: "brand_0509",
        product: "five_to_nine",
        source: "0509_web",
        user_id: "user-1",
        plan: "starter",
        cycle: "monthly",
      },
    });
    expect(JSON.stringify(body)).not.toContain("dodo-secret");
    expect(dodoCheckoutSessionId(session)).toBe("cks_123");
    expect(dodoCheckoutUrl(session)).toBe("https://checkout.dodopayments.com/session/cks_123");
  });

  it("verifies Dodo webhook signatures against the raw body", async () => {
    const rawBody = JSON.stringify({ type: "subscription.active" });
    const secret = "webhook-secret";
    const webhookId = "wh_123";
    const webhookTimestamp = "1777777000";
    const signature = hmacBase64(`${webhookId}.${webhookTimestamp}.${rawBody}`, secret);

    await expect(
      verifyDodoWebhookSignature({
        rawBody,
        webhookId,
        webhookTimestamp,
        webhookSignature: `v1=${signature}`,
        webhookSecret: secret,
        now: 1_777_777_000_000,
      }),
    ).resolves.toBeUndefined();
  });

  it("extracts the user and plan from subscription webhook metadata", () => {
    const update = parseDodoSubscriptionWebhook({
      type: "subscription.active",
      timestamp: "2026-05-03T02:56:40.000Z",
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
          brand_id: "brand_0509",
          user_id: "user-1",
          plan: "starter",
          cycle: "monthly",
        },
      },
    });

    expect(update).toMatchObject({
      event: "subscription.active",
      payloadCreatedAt: "2026-05-03T02:56:40.000Z",
      userId: "user-1",
      plan: "starter",
      status: "active",
      subscriptionId: "sub_123",
      customerId: "cust_123",
      productId: "prod_starter_monthly",
      brandId: "brand_0509",
      checkoutSessionId: "cks_123",
      shouldGrant: true,
      shouldRevoke: false,
    });
  });

  it("requires webhook product ids to match configured billing products", () => {
    expect(
      resolveDodoPlanFromProductId(
        {
          DODO_0509_PRODUCT_STARTER_MONTHLY: "prod_starter_monthly",
          DODO_0509_PRODUCT_AGENCY_MONTHLY: "prod_agency_monthly",
        },
        "prod_starter_monthly",
      ),
    ).toEqual({ plan: "starter", cycle: "monthly" });

    expect(
      isDodoWebhookProductAllowed(
        {
          DODO_0509_BRAND_ID: "brand_0509",
          DODO_0509_PRODUCT_STARTER_MONTHLY: "prod_starter_monthly",
          DODO_0509_PRODUCT_AGENCY_MONTHLY: "prod_agency_monthly",
        },
        {
          plan: "starter",
          productId: "prod_agency_monthly",
          brandId: "brand_0509",
        },
      ),
    ).toBe(false);
  });

  it("revokes access when Dodo reports a failed or on-hold subscription", () => {
    const update = parseDodoSubscriptionWebhook({
      type: "subscription.on_hold",
      data: {
        payload_type: "Subscription",
        subscription_id: "sub_123",
        product_id: "prod_starter_monthly",
        status: "on_hold",
        metadata: {
          user_id: "user-1",
          plan: "starter",
        },
      },
    });

    expect(update).toMatchObject({
      shouldGrant: false,
      shouldRevoke: true,
      status: "on_hold",
    });
  });
});
