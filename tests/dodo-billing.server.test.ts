import { describe, expect, it, vi } from "vitest";

import {
  createDodo0509CheckoutSession,
  extractDodoPlanGrant,
  extractDodoPlanRevocation,
  extractDodoProofCreditGrant,
} from "~/lib/dodo-billing.server";

const session = {
  user: {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
  },
} as never;

describe("Dodo billing", () => {
  it("creates a usage-bundle checkout with user and credit metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        checkout_url: "https://checkout.dodopayments.com/session_123",
        session_id: "session_123",
      }),
    });

    const checkout = await createDodo0509CheckoutSession({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      },
      request: new Request("https://0509.in/app"),
      session,
      target: { kind: "usage_bundle", bundle: "proof_500" },
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
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      product_cart: [{ product_id: "prod_pack_500", quantity: 1 }],
      metadata: {
        app: "0509",
        user_id: "user-1",
        target_kind: "usage_bundle",
        bundle: "proof_500",
        credits: 500,
      },
    });
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
      quantity: 2,
      credits: 4000,
      expiresAt: "2026-06-19T00:00:00.000Z",
    });
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
});

describe("Dodo subscription lifecycle", () => {
  const lifecycleEnv = {
    DODO_0509_BRAND_ID: "brand_0509",
  } as never;

  function subscriptionEnvelope(type: string, overrides: Record<string, unknown> = {}) {
    return {
      type,
      data: {
        payload_type: "Subscription",
        subscription_id: "sub_123",
        brand_id: "brand_0509",
        status: "cancelled",
        cancelled_at: "2026-07-01T00:00:00.000Z",
        created_at: "2026-06-01T00:00:00.000Z",
        metadata: {
          user_id: "user-1",
          plan: "starter",
        },
        customer: {
          customer_id: "cus_1",
          email: "owner@example.com",
          name: "Owner",
        },
        ...overrides,
      },
    };
  }

  it("extracts a revocation from subscription.cancelled", () => {
    const revocation = extractDodoPlanRevocation(
      lifecycleEnv,
      subscriptionEnvelope("subscription.cancelled"),
    );

    expect(revocation).toMatchObject({
      eventType: "subscription.cancelled",
      userId: "user-1",
      customerEmail: "owner@example.com",
      subscriptionId: "sub_123",
      revokedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("extracts revocations for expired, failed, and on-hold subscriptions", () => {
    for (const type of ["subscription.expired", "subscription.failed", "subscription.on_hold"]) {
      expect(extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope(type))).toMatchObject({
        eventType: type,
        userId: "user-1",
      });
    }
  });

  it("falls back to the customer email when metadata has no user id", () => {
    const revocation = extractDodoPlanRevocation(
      lifecycleEnv,
      subscriptionEnvelope("subscription.cancelled", { metadata: {} }),
    );

    expect(revocation).toMatchObject({
      userId: null,
      customerEmail: "owner@example.com",
    });
  });

  it("ignores non-lifecycle events and foreign brands", () => {
    expect(
      extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope("subscription.renewed")),
    ).toBeNull();
    expect(
      extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope("subscription.active")),
    ).toBeNull();
    expect(
      extractDodoPlanRevocation(lifecycleEnv, { type: "payment.succeeded", data: {} }),
    ).toBeNull();
    expect(
      extractDodoPlanRevocation(
        lifecycleEnv,
        subscriptionEnvelope("subscription.cancelled", { brand_id: "brand_other" }),
      ),
    ).toBeNull();
  });
});
