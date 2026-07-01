import { describe, expect, it, vi } from "vitest";

import {
  createDodo0509CheckoutSession,
  createDodoCustomerPortalSession,
  extractDodoPlanGrant,
  extractDodoProofCreditGrant,
  isDodoHostedCheckoutUrl,
  isDodoHostedCustomerPortalUrl,
} from "~/lib/dodo-billing.server";

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
      return_url:
        "https://0509.io/app/billing?checkout=dodo&kind=plan&source=pricing&plan=scout&cycle=monthly",
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
