import { describe, expect, it, vi } from "vitest";

import {
  changeDodo0509SubscriptionPlan,
  createDodoSubscriptionPlanChangePreviewToken,
  createDodo0509CheckoutSession,
  createDodoCustomerPortalSession,
  extractDodoPlanGrant,
	extractDodoPlanRevocation,
  extractDodoProofCreditGrant,
  extractDodoSubscriptionGrant,
  getDodo0509SubscriptionCurrency,
  getDodo0509SubscriptionPlanState,
  isDodoHostedCheckoutUrl,
  isDodoHostedCustomerPortalUrl,
  DODO_WEBHOOK_TOLERANCE_SECONDS,
  signDodoWebhookPayload,
  summarizeDodoSubscriptionPlanChangePreview,
  verifyDodoWebhookRequest,
  verifyDodoSubscriptionPlanChangePreviewToken,
} from "~/lib/dodo-billing.server";
import * as fetchTimeout from "~/lib/fetch-timeout.server";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
  },
} as never;

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", ...init.headers },
    ...init,
  });
}

describe("Dodo billing", () => {
  it("accepts a valid Dodo Standard Webhooks signature", async () => {
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const env = { DODO_0509_WEBHOOK_SECRET: "webhook-secret" } as never;
      const webhookId = "evt_signature_valid";
      const webhookTimestamp = String(now / 1000);
      const rawBody = JSON.stringify({ type: "payment.succeeded", data: { id: "pay_1" } });
      const signature = await signDodoWebhookPayload(env, webhookId, webhookTimestamp, rawBody);

      await expect(
        verifyDodoWebhookRequest(
          env,
          new Request("https://0509.io/api/webhooks/dodo", {
            method: "POST",
            headers: {
              "webhook-id": webhookId,
              "webhook-timestamp": webhookTimestamp,
              "webhook-signature": `v1=${signature}`,
            },
          }),
          rawBody,
        ),
      ).resolves.toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("rejects an invalid Dodo Standard Webhooks signature", async () => {
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const env = { DODO_0509_WEBHOOK_SECRET: "webhook-secret" } as never;
      const rawBody = JSON.stringify({ type: "payment.succeeded", data: { id: "pay_1" } });

      await expect(
        verifyDodoWebhookRequest(
          env,
          new Request("https://0509.io/api/webhooks/dodo", {
            method: "POST",
            headers: {
              "webhook-id": "evt_signature_invalid",
              "webhook-timestamp": String(now / 1000),
              "webhook-signature": "v1=invalid",
            },
          }),
          rawBody,
        ),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("rejects a Dodo webhook when required signature headers are missing", async () => {
    const env = { DODO_0509_WEBHOOK_SECRET: "webhook-secret" } as never;

    await expect(
      verifyDodoWebhookRequest(
        env,
        new Request("https://0509.io/api/webhooks/dodo", {
          method: "POST",
          headers: {
            "webhook-id": "evt_signature_missing",
            "webhook-timestamp": "1700000000",
          },
        }),
        "{}",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a correctly signed Dodo webhook outside the replay window", async () => {
    const now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const env = { DODO_0509_WEBHOOK_SECRET: "webhook-secret" } as never;
      const webhookId = "evt_signature_stale";
      const webhookTimestamp = String(now / 1000 - DODO_WEBHOOK_TOLERANCE_SECONDS - 1);
      const rawBody = JSON.stringify({ type: "payment.succeeded", data: { id: "pay_1" } });
      const signature = await signDodoWebhookPayload(env, webhookId, webhookTimestamp, rawBody);

      await expect(
        verifyDodoWebhookRequest(
          env,
          new Request("https://0509.io/api/webhooks/dodo", {
            method: "POST",
            headers: {
              "webhook-id": webhookId,
              "webhook-timestamp": webhookTimestamp,
              "webhook-signature": `v1=${signature}`,
            },
          }),
          rawBody,
        ),
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("creates a usage-bundle checkout with user and credit metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        checkout_url: "https://checkout.dodopayments.com/session_123",
        session_id: "session_123",
      }),
    );

    const checkout = await createDodo0509CheckoutSession({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      },
      request: new Request("https://0509.io/app"),
      session,
      target: { kind: "top_up", sku: "burst_500_v1", quantity: 500 },
      fetcher: fetcher as never,
    });

    expect(checkout).toEqual({
      checkoutUrl: "https://checkout.dodopayments.com/session_123",
      sessionId: "session_123",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://live.dodopayments.com/checkouts",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
    const requestBody = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(requestBody.return_url).toMatch(
      /^https:\/\/0509\.io\/app\/billing\?checkout=dodo&kind=top_up&sku=burst_500_v1&started=/,
    );
    expect(requestBody.cancel_url).toBe(
      "https://0509.io/app/billing?checkout=cancelled&kind=top_up&sku=burst_500_v1#top-ups",
    );
    expect(requestBody).toMatchObject({
      product_cart: [{ product_id: "prod_pack_500", quantity: 1 }],
      adaptive_currency_fees_inclusive: true,
      metadata: {
        app: "0509",
        user_id: "user-1",
        target_kind: "top_up",
        sku: "burst_500_v1",
        bundle: "proof_500",
      },
    });
  });

  it("creates a plan checkout with the validated Dodo pricing context", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        checkout_url: "https://checkout.dodopayments.com/session_plan",
        session_id: "session_plan",
      }),
    );

    await createDodo0509CheckoutSession({
      env: {
        DODO_0509_ADAPTIVE_CURRENCY: "true",
        DODO_0509_ADAPTIVE_CURRENCY_FEES_INCLUSIVE: "false",
        DODO_0509_API_KEY: "secret",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      },
      request: new Request("https://0509.io/app"),
      session,
      target: { kind: "plan", sku: "scout_monthly_v1", planFamily: "scout", cycle: "monthly" },
      pricingContext: {
        billingCountry: "in",
        billingCurrency: "inr",
      },
      checkoutId: "checkout_plan_1",
      source: "pricing",
      fetcher: fetcher as never,
    });

    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      product_cart: [{ product_id: "prod_scout_monthly", quantity: 1 }],
      adaptive_currency_fees_inclusive: false,
      billing_address: { country: "IN" },
      billing_currency: "INR",
      return_url: expect.stringMatching(
        /^https:\/\/0509\.io\/app\/billing\?checkout=dodo&kind=plan&source=pricing&plan=scout&cycle=monthly&started=/,
      ),
      cancel_url:
        "https://0509.io/api/billing/dodo/cancel?checkout_id=checkout_plan_1&plan=scout&cycle=monthly&source=pricing",
      metadata: {
        app: "0509",
        user_id: "user-1",
        target_kind: "plan",
        checkout_id: "checkout_plan_1",
        sku: "scout_monthly_v1",
        source: "pricing",
        plan: "scout",
        cycle: "monthly",
      },
    });
  });

  it("summarizes plan-change preview charges only when Dodo proves the currency", () => {
    expect(
      summarizeDodoSubscriptionPlanChangePreview(
        {
          immediate_charge: {
            summary: { settlement_amount: 9999, total_amount: 1234 },
          },
        },
        "INR",
      ),
    ).toMatchObject({ amount: 1234, currency: "INR", display: expect.stringContaining("12.34") });

    expect(
      summarizeDodoSubscriptionPlanChangePreview(
        {
          immediate_charge: {
            summary: { total_amount: 1234 },
          },
        },
        "",
      ),
    ).toBeNull();
  });

  it("reads the subscription currency from Dodo subscription detail", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ currency: "GBP" }));

    await expect(
      getDodo0509SubscriptionCurrency({
        env: { DODO_0509_API_KEY: "secret" },
        subscriptionId: "sub_123",
        fetcher: fetcher as never,
      }),
    ).resolves.toBe("GBP");

    expect(fetcher).toHaveBeenCalledWith(
      "https://live.dodopayments.com/subscriptions/sub_123",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
  });

  it("reads the authoritative current and scheduled plan state without mutating Dodo", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        subscription_id: "sub_123",
        product_id: "prod_scout_monthly",
        status: "active",
        next_billing_date: "2026-08-04T12:00:00.000Z",
        scheduled_change: { product_id: "prod_starter_monthly" },
      }),
    );

    await expect(
      getDodo0509SubscriptionPlanState({
        env: { DODO_0509_API_KEY: "secret" },
        subscriptionId: "sub_123",
        fetcher: fetcher as never,
        observedAt: "2026-07-16T14:50:00.000Z",
      }),
    ).resolves.toEqual({
      subscriptionId: "sub_123",
      productId: "prod_scout_monthly",
      status: "active",
      nextBillingAt: "2026-08-04T12:00:00.000Z",
      scheduledChangeProductId: "prod_starter_monthly",
      observedAt: "2026-07-16T14:50:00.000Z",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "https://live.dodopayments.com/subscriptions/sub_123",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fails closed when Dodo subscription identity or required state is unreadable", async () => {
    const wrongIdentity = vi.fn().mockResolvedValue(
      jsonResponse({
        subscription_id: "sub_other",
        product_id: "prod_scout_monthly",
        status: "active",
      }),
    );
    const missingProduct = vi.fn().mockResolvedValue(
      jsonResponse({ subscription_id: "sub_123", status: "active" }),
    );

    await expect(
      getDodo0509SubscriptionPlanState({
        env: { DODO_0509_API_KEY: "secret" },
        subscriptionId: "sub_123",
        fetcher: wrongIdentity as never,
      }),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      getDodo0509SubscriptionPlanState({
        env: { DODO_0509_API_KEY: "secret" },
        subscriptionId: "sub_123",
        fetcher: missingProduct as never,
      }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("releases timed responses when Dodo rejects a subscription plan change", async () => {
    const response = jsonResponse({ error: "invalid" }, { status: 400 });
    const fetcher = vi.fn().mockResolvedValue(response);
    const releaseSpy = vi.spyOn(fetchTimeout, "releaseFetchTimeout");

    await expect(
      changeDodo0509SubscriptionPlan({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        },
        subscriptionId: "sub_123",
        target: {
          kind: "plan",
          sku: "starter_monthly_v1",
          planFamily: "starter",
          cycle: "monthly",
        },
        userId: "user-1",
        effectiveAt: "immediately",
        prorationBillingMode: "prorated_immediately",
        fetcher: fetcher as never,
      }),
    ).rejects.toMatchObject({ kind: "provider_rejected" });

    expect(releaseSpy).toHaveBeenCalledWith(response);
  });

  it("binds subscription plan-change confirmation tokens to the previewed amount", async () => {
    const env = { BETTER_AUTH_SECRET: "signing-secret" };
    const target = {
      kind: "plan",
      sku: "starter_monthly_v1",
      planFamily: "starter",
      cycle: "monthly",
    } as const;
    const preview = {
      subscriptionId: "sub_123",
      userId: "user-1",
      target,
      effectiveAt: "immediately" as const,
      prorationBillingMode: "prorated_immediately" as const,
      amount: 1234,
      currency: "INR",
    };

	    const token = await createDodoSubscriptionPlanChangePreviewToken(env as never, preview);
	    const [encodedPayload] = token.split(".");
	    const tokenPayload = JSON.parse(
	      Buffer.from(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
	    ) as Record<string, unknown>;

	    await expect(
	      verifyDodoSubscriptionPlanChangePreviewToken(env as never, token, preview),
	    ).resolves.toBe(true);
	    expect(tokenPayload.ctx).toEqual(expect.any(String));
	    expect(tokenPayload.sub).toBeUndefined();
	    expect(tokenPayload.user).toBeUndefined();
	    expect(JSON.stringify(tokenPayload)).not.toContain("sub_123");
	    expect(JSON.stringify(tokenPayload)).not.toContain("user-1");
	    await expect(
	      verifyDodoSubscriptionPlanChangePreviewToken(env as never, token, {
	        ...preview,
        amount: 1235,
      }),
    ).resolves.toBe(false);
	  });

	  it("does not treat subscription created_at as a plan-change grant timestamp", () => {
	    const grant = extractDodoSubscriptionGrant(
	      {
	        DODO_0509_BRAND_ID: "brand_0509",
	        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
	      },
	      {
	        type: "subscription.plan_changed",
	        data: {
	          brand_id: "brand_0509",
	          subscription_id: "sub_123",
	          product_id: "prod_starter_yearly",
	          is_subscription: true,
	          is_recurring: true,
	          previous_billing_date: "2026-07-02T00:00:00.000Z",
	          next_billing_date: "2027-07-02T00:00:00.000Z",
	          created_at: "2026-06-02T00:00:00.000Z",
	          customer: { customer_id: "cus_123" },
	          metadata: {
	            app: "0509",
	            user_id: "user-1",
	            target_kind: "plan",
	            plan: "starter",
	            cycle: "yearly",
	          },
	        },
	      },
	    );

	    expect(grant).toMatchObject({
	      eventType: "subscription.plan_changed",
	      grantedAt: null,
	      hasProviderGrantTimestamp: false,
	    });
	  });

	  it("extracts subscription plan changes as plan grants from Dodo lifecycle webhooks", () => {
    const grant = extractDodoSubscriptionGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
      },
      {
        type: "subscription.plan_changed",
        data: {
          brand_id: "brand_0509",
          subscription_id: "sub_123",
          product_id: "prod_starter_yearly",
          is_subscription: true,
          is_recurring: true,
          previous_billing_date: "2026-07-02T00:00:00.000Z",
          next_billing_date: "2027-07-02T00:00:00.000Z",
          updated_at: "2026-07-02T00:01:00.000Z",
          customer: { customer_id: "cus_123" },
          metadata: {
            app: "0509",
            user_id: "user-1",
            target_kind: "plan",
            plan: "starter",
            cycle: "yearly",
          },
        },
      },
    );

    expect(grant).toMatchObject({
      eventType: "subscription.plan_changed",
      userId: "user-1",
      subscriptionId: "sub_123",
      customerId: "cus_123",
      productId: "prod_starter_yearly",
      plan: "starter",
      cycle: "yearly",
      status: "active",
      grantedAt: "2026-07-02T00:01:00.000Z",
      nextBillingAt: "2027-07-02T00:00:00.000Z",
    });
  });

  it("returns a temporary checkout failure when Dodo response body aborts after headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new DOMException("deadline", "AbortError"));
          },
        }),
        { status: 200 },
      ),
    );

    await expect(
      createDodo0509CheckoutSession({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
        },
        request: new Request("https://0509.io/app"),
        session,
        target: { kind: "top_up", sku: "burst_500_v1", quantity: 500 },
        fetcher: fetcher as never,
      }),
    ).rejects.toMatchObject({
      status: 502,
    });
  });

  it("does not expose Dodo provider error messages from checkout failures", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          message: "provider says product prod_secret_123 is not enabled",
        },
        { status: 400 },
      ),
    );

    try {
      await createDodo0509CheckoutSession({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
        },
        request: new Request("https://0509.io/app"),
        session,
        target: { kind: "top_up", sku: "burst_500_v1", quantity: 500 },
        fetcher: fetcher as never,
      });
      throw new Error("expected checkout failure");
    } catch (error) {
      const response = error as Response;
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(502);
      await expect(response.text()).resolves.toBe(
        "Dodo checkout is temporarily unavailable. Please try again.",
      );
    }
  });

  it("rejects unsafe checkout URLs from the provider response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        checkout_url: "https://example.com/phish",
        session_id: "session_bad",
      }),
    );

    await expect(
      createDodo0509CheckoutSession({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
        },
        request: new Request("https://0509.io/app"),
        session,
        target: { kind: "top_up", sku: "burst_500_v1", quantity: 500 },
        fetcher: fetcher as never,
      }),
    ).rejects.toMatchObject({
      status: 502,
    });

    expect(isDodoHostedCheckoutUrl("https://checkout.dodopayments.com/session")).toBe(true);
    expect(isDodoHostedCheckoutUrl("https://test.checkout.dodopayments.com/session")).toBe(true);
    expect(isDodoHostedCheckoutUrl("http://checkout.dodopayments.com/session")).toBe(false);
    expect(isDodoHostedCheckoutUrl("https://example.com/session")).toBe(false);
  });

  it("creates a bounded Dodo portal session with a safe return URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        link: "https://customer.dodopayments.com/session_123",
      }),
    );

    const portalUrl = await createDodoCustomerPortalSession(
      {
        DODO_0509_API_KEY: "secret",
        DODO_0509_ENVIRONMENT: "test",
      },
      "cus_123",
      {
        request: new Request("https://0509.io/app/billing"),
        fetcher: fetcher as never,
      },
    );

    expect(portalUrl).toBe("https://customer.dodopayments.com/session_123");
    const [requestUrl, init] = fetcher.mock.calls[0];
    const endpoint = new URL(requestUrl);
    expect(endpoint.origin + endpoint.pathname).toBe(
      "https://test.dodopayments.com/customers/cus_123/customer-portal/session",
    );
    expect(endpoint.searchParams.get("return_url")).toBe("https://0509.io/app/billing");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });

  it("rejects non-Dodo portal links from the provider response", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ link: "https://example.com/phish" }));

    await expect(
      createDodoCustomerPortalSession(
        { DODO_0509_API_KEY: "secret" },
        "cus_123",
        { fetcher: fetcher as never },
      ),
    ).resolves.toBeNull();
    expect(isDodoHostedCustomerPortalUrl("https://customer.dodopayments.com/session")).toBe(true);
    expect(isDodoHostedCustomerPortalUrl("http://customer.dodopayments.com/session")).toBe(false);
    expect(isDodoHostedCustomerPortalUrl("https://example.com/session")).toBe(false);
  });

  it("returns null for unconfigured Dodo portal sessions without calling the provider", async () => {
    const fetcher = vi.fn();

    await expect(
      createDodoCustomerPortalSession({}, "cus_123", { fetcher: fetcher as never }),
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null for failed Dodo portal provider responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ error: "unavailable" }, { status: 500 }));

    await expect(
      createDodoCustomerPortalSession(
        { DODO_0509_API_KEY: "secret" },
        "cus_123",
        { fetcher: fetcher as never },
      ),
    ).resolves.toBeNull();
  });

  it("returns null for malformed Dodo portal provider responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{not-json", { status: 200 }));

    await expect(
      createDodoCustomerPortalSession(
        { DODO_0509_API_KEY: "secret" },
        "cus_123",
        { fetcher: fetcher as never },
      ),
    ).resolves.toBeNull();
  });

  it("returns null for oversized Dodo portal provider responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "content-length": "32001",
        },
      }),
    );

    await expect(
      createDodoCustomerPortalSession(
        { DODO_0509_API_KEY: "secret" },
        "cus_123",
        { fetcher: fetcher as never },
      ),
    ).resolves.toBeNull();
  });

  it("returns null when Dodo portal provider fetch rejects", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      createDodoCustomerPortalSession(
        { DODO_0509_API_KEY: "secret" },
        "cus_123",
        { fetcher: fetcher as never },
      ),
    ).resolves.toBeNull();
  });

  it("extracts a proof-credit grant from a Dodo payment payload", () => {
    const grant = extractDodoProofCreditGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_PROOF_PACK_2000_ID: "prod_pack_2000",
      },
      {
	        id: "pay_123",
	        brand_id: "brand_0509",
	        created_at: "2026-05-20T00:00:00.000Z",
	        expires_at: "2026-05-20T00:00:00.000Z",
	        status: "succeeded",
        metadata: {
          user_id: "user-1",
        },
        product_cart: [
          {
            product_id: "prod_pack_2000",
            quantity: 2,
          },
        ],
      },
    );

    expect(grant).toMatchObject({
      userId: "user-1",
      paymentId: "pay_123",
      productId: "prod_pack_2000",
      bundle: "proof_2000",
      skuSlug: "campaign_2000_v1",
      quantity: 2,
      credits: 4000,
    });
    expect(grant).not.toHaveProperty("expiresAt");
  });

  it("extracts a paid plan grant from a Dodo payment payload", () => {
    const grant = extractDodoPlanGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      },
      {
        id: "pay_scout",
        brand_id: "brand_0509",
        status: "succeeded",
        metadata: {
          user_id: "user-1",
        },
        product_cart: [
          {
            product_id: "prod_scout_monthly",
            quantity: 1,
          },
        ],
      },
    );

    expect(grant).toMatchObject({
      userId: "user-1",
      paymentId: "pay_scout",
      productId: "prod_scout_monthly",
      plan: "scout",
      cycle: "monthly",
      status: "succeeded",
    });
  });

  it("rejects metadata-only plan grants when product_cart is absent", () => {
    // Verified against live Dodo payloads (2026-06-12): subscription
    // payment.succeeded events can carry product_cart: null, so 0509 requires
    // its signed checkout metadata to include a configured SKU.
    const grant = extractDodoPlanGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
      },
      {
        type: "payment.succeeded",
        data: {
          payload_type: "Payment",
          payment_id: "pay_real_sub",
          brand_id: "brand_0509",
          status: "succeeded",
          subscription_id: "sub_123",
          product_cart: null,
          metadata: {
            app: "0509",
            user_id: "user-1",
            target_kind: "plan",
            plan: "scout",
            cycle: "monthly",
          },
          customer: {
            customer_id: "cus_123",
            email: "owner@example.com",
          },
          created_at: "2026-06-12T05:30:00.000Z",
        },
      },
    );

    expect(grant).toBeNull();
  });

  it("recovers annual product identity from trusted checkout metadata when payment product_cart is absent", () => {
    const grant = extractDodoPlanGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_annual",
      },
      {
        type: "payment.succeeded",
        data: {
          payload_type: "Payment",
          payment_id: "pay_real_annual",
          brand_id: "brand_0509",
          status: "succeeded",
          subscription_id: "sub_annual",
          product_cart: null,
          metadata: {
            app: "0509",
            user_id: "user-1",
            target_kind: "plan",
            sku: "starter_annual_v1",
            plan: "starter",
            cycle: "yearly",
          },
          customer: {
            customer_id: "cus_annual",
            email: "owner@example.com",
          },
          created_at: "2026-06-12T05:30:00.000Z",
        },
      },
    );

    expect(grant).toMatchObject({
      userId: "user-1",
      paymentId: "pay_real_annual",
      productId: "prod_starter_annual",
      plan: "starter",
      cycle: "yearly",
      subscriptionId: "sub_annual",
      customerId: "cus_annual",
    });
  });

  it("does not treat a usage-bundle payment as a plan grant when the cart is absent", () => {
    const grant = extractDodoPlanGrant(
      { DODO_0509_BRAND_ID: "brand_0509" },
      {
        type: "payment.succeeded",
        data: {
          payload_type: "Payment",
          payment_id: "pay_bundle",
          brand_id: "brand_0509",
          status: "succeeded",
          product_cart: null,
          metadata: {
            app: "0509",
            user_id: "user-1",
            target_kind: "usage_bundle",
            bundle: "proof_500",
            credits: "500",
          },
        },
      },
    );

    expect(grant).toBeNull();
  });

  it("does not grant metadata-only plan access without the 0509 plan marker", () => {
    const grant = extractDodoPlanGrant(
      { DODO_0509_BRAND_ID: "brand_0509" },
      {
        type: "payment.succeeded",
        data: {
          payload_type: "Payment",
          payment_id: "pay_other_product",
          brand_id: "brand_0509",
          status: "succeeded",
          subscription_id: "sub_other",
          product_cart: null,
          metadata: {
            user_id: "user-1",
            plan: "agency",
            cycle: "monthly",
          },
        },
      },
    );

    expect(grant).toBeNull();
  });

  it("still grants configured plan products even when metadata has no app marker", () => {
    const grant = extractDodoPlanGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_AGENCY_MONTHLY_ID: "prod_agency_monthly",
      },
      {
        type: "payment.succeeded",
        data: {
          payload_type: "Payment",
          payment_id: "pay_product_backed",
          brand_id: "brand_0509",
          status: "succeeded",
          metadata: {
            user_id: "user-1",
            plan: "scout",
          },
          product_cart: [
            {
              product_id: "prod_agency_monthly",
              quantity: 1,
            },
          ],
        },
      },
    );

    expect(grant).toMatchObject({ plan: "agency", cycle: "monthly" });
  });

  it("extracts paid grants from current Dodo envelope payloads", () => {
    const grant = extractDodoPlanGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
      },
      {
        type: "payment.succeeded",
        data: {
          payment_id: "pay_starter",
          brand_id: "brand_0509",
          status: "succeeded",
          metadata: {
            user_id: "user-1",
          },
          product_cart: [
            {
              product_id: "prod_starter_monthly",
              quantity: 1,
            },
          ],
        },
      },
    );

	  expect(grant).toMatchObject({
	    userId: "user-1",
	    paymentId: "pay_starter",
	    productId: "prod_starter_monthly",
	    plan: "starter",
	    cycle: "monthly",
	    status: "succeeded",
	  });
	});

	it("uses the Dodo payment update timestamp for paid plan ordering when available", () => {
	  const grant = extractDodoPlanGrant(
	    {
	      DODO_0509_BRAND_ID: "brand_0509",
	      DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
	    },
	    {
	      type: "payment.succeeded",
	      data: {
	        payment_id: "pay_starter",
	        brand_id: "brand_0509",
	        created_at: "2026-06-04T12:00:00.000Z",
	        updated_at: "2026-06-05T08:00:00.000Z",
	        status: "succeeded",
	        metadata: {
	          user_id: "user-1",
	        },
	        product_cart: [
	          {
	            product_id: "prod_starter_monthly",
	            quantity: 1,
	          },
	        ],
	      },
	    },
	  );

	  expect(grant).toMatchObject({
	    grantedAt: "2026-06-05T08:00:00.000Z",
	  });
	});

  it("does not grant paid access or proof credits for non-successful Dodo payment events", () => {
    const env = {
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
    };
    const failedPlanPayment = {
      type: "payment.failed",
      data: {
        payment_id: "pay_failed",
        brand_id: "brand_0509",
        status: "failed",
        metadata: {
          user_id: "user-1",
        },
        product_cart: [
          {
            product_id: "prod_scout_monthly",
            quantity: 1,
          },
        ],
      },
    };
    const processingCreditPayment = {
      id: "pay_processing",
      brand_id: "brand_0509",
      status: "processing",
      metadata: {
        user_id: "user-1",
      },
      product_cart: [
        {
          product_id: "prod_pack_500",
          quantity: 1,
        },
      ],
    };

    expect(extractDodoPlanGrant(env, failedPlanPayment)).toBeNull();
    expect(extractDodoProofCreditGrant(env, processingCreditPayment)).toBeNull();
  });

	it("uses the payment identity when payment.failed has no subscription_id", () => {
		expect(extractDodoPlanRevocation({ DODO_0509_BRAND_ID: "brand_0509" }, {
			type: "payment.failed",
			data: {
				payment_id: "pay_fallback",
				brand_id: "brand_0509",
				updated_at: "2026-07-01T08:00:00.000Z",
				metadata: { app: "0509", target_kind: "plan", plan: "starter", user_id: "user-1" },
			},
		})).toMatchObject({
			eventType: "payment.failed", action: "payment_issue", userId: "user-1",
			subscriptionId: "payment.failed", paymentId: "pay_fallback",
			revokedAt: "2026-07-01T08:00:00.000Z",
		});
	});

  it("does not let a one-time Dodo product grant paid plan access through metadata", () => {
    const grant = extractDodoPlanGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      },
      {
        type: "payment.succeeded",
        data: {
          payment_id: "pay_miswired",
          brand_id: "brand_0509",
          status: "succeeded",
          metadata: {
            app: "0509",
            user_id: "user-1",
            target_kind: "plan",
            plan: "starter",
            cycle: "monthly",
          },
          product_cart: [
            {
              product_id: "prod_pack_500",
              is_subscription: false,
              quantity: 1,
            },
          ],
        },
      },
    );

    expect(grant).toBeNull();
  });

  it("does not let a subscription Dodo product grant one-time proof credits", () => {
    const grant = extractDodoProofCreditGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      },
      {
        type: "payment.succeeded",
        data: {
          payment_id: "pay_sub_topup",
          brand_id: "brand_0509",
          status: "succeeded",
          metadata: {
            user_id: "user-1",
          },
          product_cart: [
            {
              product_id: "prod_pack_500",
              is_subscription: true,
              quantity: 1,
            },
          ],
        },
      },
    );

    expect(grant).toBeNull();
  });
});
