import { describe, expect, it, vi } from "vitest";

import {
  createDodo0509CheckoutSession,
  extractDodoPlanGrant,
  extractDodoPlanRevocation,
  extractDodoProofCreditGrant,
  extractDodoRefund,
  extractDodoSubscriptionGrant,
  isDodoWebhookTimestampFresh,
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
      request: new Request("https://0509.io/app"),
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

  it("grants from metadata when product_cart is absent — the real subscription payment shape", () => {
    // Verified against live Dodo payloads (2026-06-12): subscription
    // payment.succeeded events carry product_cart: null; only checkout
    // metadata identifies the plan.
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

    expect(grant).toMatchObject({
      userId: "user-1",
      paymentId: "pay_real_sub",
      productId: null,
      plan: "scout",
      cycle: "monthly",
      subscriptionId: "sub_123",
      customerId: "cus_123",
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
          app: "0509",
          user_id: "user-1",
          target_kind: "plan",
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
      action: "revoke",
      userId: "user-1",
      customerEmail: "owner@example.com",
      subscriptionId: "sub_123",
      revokedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("extracts trusted lifecycle events without a metadata user id for database resolution", () => {
    const revocation = extractDodoPlanRevocation(
      lifecycleEnv,
      subscriptionEnvelope("subscription.expired", {
        metadata: {
          app: "0509",
          target_kind: "plan",
          plan: "starter",
        },
      }),
    );

    expect(revocation).toMatchObject({
      eventType: "subscription.expired",
      action: "revoke",
      userId: null,
      customerId: "cus_1",
      customerEmail: "owner@example.com",
      subscriptionId: "sub_123",
    });
  });

  it("treats cancelled/expired as revocations but failed/on-hold as payment issues", () => {
    for (const type of ["subscription.cancelled", "subscription.expired"]) {
      expect(extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope(type))).toMatchObject({
        eventType: type,
        action: "revoke",
        userId: "user-1",
      });
    }

    // Dunning states keep the paid plan; only the status flag changes.
    for (const type of ["subscription.failed", "subscription.on_hold"]) {
      expect(extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope(type))).toMatchObject({
        eventType: type,
        action: "payment_issue",
        userId: "user-1",
      });
    }
  });

  it("extracts a full refund and ignores partial refunds and foreign brands", () => {
    const refundEnvelope = (overrides: Record<string, unknown> = {}) => ({
      type: "refund.succeeded",
      data: {
        payload_type: "Refund",
        refund_id: "ref_1",
        payment_id: "pay_1",
        brand_id: "brand_0509",
        is_partial: false,
        created_at: "2026-07-05T00:00:00.000Z",
        ...overrides,
      },
    });

    expect(extractDodoRefund(lifecycleEnv, refundEnvelope())).toMatchObject({
      eventType: "refund.succeeded",
      paymentId: "pay_1",
      refundId: "ref_1",
      refundedAt: "2026-07-05T00:00:00.000Z",
    });
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ is_partial: true }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ brand_id: "brand_other" }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, { type: "refund.failed", data: {} })).toBeNull();
  });

  it("rejects stale webhook timestamps outside the replay tolerance", () => {
    const now = Date.parse("2026-06-11T12:00:00.000Z");
    const fresh = String(Math.floor(now / 1000) - 60);
    const stale = String(Math.floor(now / 1000) - 600);
    const future = String(Math.floor(now / 1000) + 600);

    expect(isDodoWebhookTimestampFresh(fresh, now)).toBe(true);
    expect(isDodoWebhookTimestampFresh(stale, now)).toBe(false);
    expect(isDodoWebhookTimestampFresh(future, now)).toBe(false);
    expect(isDodoWebhookTimestampFresh("2026-06-11T11:59:00.000Z", now)).toBe(true);
    expect(isDodoWebhookTimestampFresh("2026-06-11T00:00:00.000Z", now)).toBe(false);
    expect(isDodoWebhookTimestampFresh("not-a-timestamp", now)).toBe(false);
  });

  it("extracts lifecycle events with stored-linkage ids even when plan proof is absent", () => {
    const revocation = extractDodoPlanRevocation(
      lifecycleEnv,
      subscriptionEnvelope("subscription.cancelled", { metadata: {} }),
    );

    expect(revocation).toMatchObject({
      eventType: "subscription.cancelled",
      action: "revoke",
      userId: null,
      customerId: "cus_1",
      customerEmail: null,
      subscriptionId: "sub_123",
    });
  });

  it("ignores lifecycle events without user, linkage ids, or plan proof", () => {
    const revocation = extractDodoPlanRevocation(
      lifecycleEnv,
      subscriptionEnvelope("subscription.cancelled", {
        subscription_id: "",
        id: "",
        metadata: {},
        customer: {
          email: "owner@example.com",
        },
      }),
    );

    expect(revocation).toBeNull();
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

describe("extractDodoSubscriptionGrant", () => {
  const env = {
    DODO_0509_BRAND_ID: "brand_0509",
    DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "pdt_starter_monthly",
  } as never;

  function subscriptionPayload(type: string, overrides: Record<string, unknown> = {}) {
    // Shape verified against the live Dodo subscriptions API (2026-06-12).
    return {
      type,
      data: {
        payload_type: "Subscription",
        subscription_id: "sub_123",
        product_id: "pdt_starter_monthly",
        brand_id: "brand_0509",
        status: "active",
        metadata: {
          app: "0509",
          user_id: "user-1",
          target_kind: "plan",
          plan: "starter",
          cycle: "monthly",
        },
        customer: {
          customer_id: "cus_123",
          email: "owner@example.com",
        },
        previous_billing_date: "2026-07-12T05:30:00.000Z",
        next_billing_date: "2026-08-12T05:30:00.000Z",
        created_at: "2026-06-12T05:30:00.000Z",
        cancel_at_next_billing_date: false,
        ...overrides,
      },
    };
  }

  it("grants from subscription.active and subscription.renewed", () => {
    for (const type of ["subscription.active", "subscription.renewed"]) {
      expect(extractDodoSubscriptionGrant(env, subscriptionPayload(type))).toMatchObject({
        eventType: type,
        userId: "user-1",
        subscriptionId: "sub_123",
        customerId: "cus_123",
        plan: "starter",
        cycle: "monthly",
        status: "active",
        grantedAt: "2026-07-12T05:30:00.000Z",
        nextBillingAt: "2026-08-12T05:30:00.000Z",
      });
    }
  });

  it("falls back to metadata when the product id is unknown", () => {
    const grant = extractDodoSubscriptionGrant(
      { DODO_0509_BRAND_ID: "brand_0509" } as never,
      subscriptionPayload("subscription.renewed", { product_id: "pdt_unmapped" }),
    );

    expect(grant).toMatchObject({ plan: "starter", cycle: "monthly" });
  });

  it("ignores unknown subscription products without trusted 0509 metadata", () => {
    const grant = extractDodoSubscriptionGrant(
      { DODO_0509_BRAND_ID: "brand_0509" } as never,
      subscriptionPayload("subscription.renewed", {
        product_id: "pdt_unmapped",
        metadata: {
          user_id: "user-1",
          plan: "starter",
          cycle: "monthly",
        },
      }),
    );

    expect(grant).toBeNull();
  });

  it("ignores other lifecycle events and foreign brands", () => {
    expect(
      extractDodoSubscriptionGrant(env, subscriptionPayload("subscription.cancelled")),
    ).toBeNull();
    expect(
      extractDodoSubscriptionGrant(env, subscriptionPayload("subscription.on_hold")),
    ).toBeNull();
    expect(
      extractDodoSubscriptionGrant(
        env,
        subscriptionPayload("subscription.renewed", { brand_id: "brand_other" }),
      ),
    ).toBeNull();
  });
});
