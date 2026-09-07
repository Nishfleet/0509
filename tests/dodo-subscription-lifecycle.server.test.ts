import { describe, expect, it } from "vitest";

import {
  extractDodoPlanCheckoutFailure,
  extractDodoPlanRevocation,
  extractDodoRefund,
  extractDodoSubscriptionGrant,
  isDodoWebhookTimestampFresh,
} from "~/lib/dodo-billing.server";

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

	it("uses the stable envelope event timestamp when lifecycle data has no provider timestamps", () => {
		const payload = {
			...subscriptionEnvelope("subscription.on_hold", {
				updated_at: "",
				cancelled_at: "",
				created_at: "",
			}),
			timestamp: "2026-07-01T08:00:00.000Z",
		};

		expect(extractDodoPlanRevocation(lifecycleEnv, payload)).toMatchObject({
			action: "payment_issue",
			revokedAt: "2026-07-01T08:00:00.000Z",
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

    // Dunning states keep the paid plan; only the status flag changes. Initial
    // subscription mandate failures also carry checkout metadata and are gated
    // by the webhook route against the pending checkout lock.
    expect(extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope("subscription.on_hold"))).toMatchObject({
      eventType: "subscription.on_hold",
      action: "payment_issue",
      status: "subscription.on_hold",
      userId: "user-1",
    });
    expect(extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope("subscription.failed"))).toMatchObject({
      eventType: "subscription.failed",
      action: "payment_issue",
      status: "subscription.failed",
      userId: "user-1",
    });
    expect(extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope("payment.failed"))).toMatchObject({
      eventType: "payment.failed",
      action: "payment_issue",
      status: "payment.failed",
      userId: "user-1",
    });
    expect(
      extractDodoPlanRevocation(lifecycleEnv, subscriptionEnvelope("payment.failed", {
        status: "failed",
        metadata: {
          app: "0509",
          user_id: "user-1",
          target_kind: "plan",
          plan: "starter",
          checkout_id: "checkout_original_plan",
        },
      })),
    ).toMatchObject({
      eventType: "payment.failed",
      action: "payment_issue",
      status: "payment.failed",
      subscriptionId: "sub_123",
    });
    expect(extractDodoPlanCheckoutFailure(lifecycleEnv, subscriptionEnvelope("subscription.failed", {
      status: "failed",
      updated_at: "2026-07-01T00:00:00.000Z",
    }))).toBeNull();
    expect(
      extractDodoPlanCheckoutFailure(lifecycleEnv, subscriptionEnvelope("subscription.failed", {
        status: "failed",
        updated_at: "2026-07-01T00:00:00.000Z",
        metadata: {
          app: "0509",
          user_id: "user-1",
          target_kind: "plan",
          plan: "starter",
          checkout_id: "checkout_failed_sub",
        },
      })),
    ).toMatchObject({
      eventType: "subscription.failed",
      userId: "user-1",
      checkoutId: "checkout_failed_sub",
      status: "failed",
      failedAt: "2026-07-01T00:00:00.000Z",
    });
  });

  it("extracts full and partial succeeded refunds while rejecting non-terminal or foreign events", () => {
    const refundEnvelope = (overrides: Record<string, unknown> = {}) => ({
      type: "refund.succeeded",
      data: {
        payload_type: "Refund",
        refund_id: "ref_1",
        payment_id: "pay_1",
        brand_id: "brand_0509",
        status: "succeeded",
        is_partial: false,
        amount: 1299,
        currency: "usd",
        reason: "requested_by_customer",
        created_at: "2026-07-05T00:00:00.000Z",
        ...overrides,
      },
    });

    expect(extractDodoRefund(lifecycleEnv, refundEnvelope())).toMatchObject({
      eventType: "refund.succeeded",
      paymentId: "pay_1",
      refundId: "ref_1",
      refundAmount: 1299,
      refundCurrency: "USD",
      refundReason: "requested_by_customer",
      refundType: "full",
      refundedAt: "2026-07-05T00:00:00.000Z",
    });
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ is_partial: true }))).toMatchObject({
      paymentId: "pay_1",
      refundType: "partial",
    });
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ is_partial: undefined }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ status: undefined }))).toBeNull();
    expect(
      extractDodoRefund(lifecycleEnv, {
        type: "refund.succeeded",
        ...refundEnvelope().data,
      }),
    ).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ brand_id: undefined }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ refund_id: undefined }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ created_at: undefined }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ created_at: "not-a-date" }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ amount: -1 }))).toMatchObject({
      refundAmount: null,
    });
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ is_partial: "false" }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ status: "pending" }))).toBeNull();
    expect(extractDodoRefund(lifecycleEnv, refundEnvelope({ status: "failed" }))).toBeNull();
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
		// CAUTION: the live Dodo subscriptions API returns NO updated_at field
		// (re-verified 2026-07-13; the 2026-06-12 "verified" shape was wrong about
		// it). Extraction may still prefer updated_at if Dodo ever adds it, but
		// every consumer must also handle its absence — see the plan_changed
		// scheduled-cancellation tests, which exercise the no-updated_at shape.
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
        updated_at: "2026-07-12T05:31:00.000Z",
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
        grantedAt: "2026-07-12T05:31:00.000Z",
        nextBillingAt: "2026-08-12T05:30:00.000Z",
      });
    }
  });

  it("uses previous billing date for renewal grants when updated_at is absent", () => {
    expect(
      extractDodoSubscriptionGrant(
        env,
        subscriptionPayload("subscription.renewed", { updated_at: "" }),
      ),
    ).toMatchObject({
      grantedAt: "2026-07-12T05:30:00.000Z",
      nextBillingAt: "2026-08-12T05:30:00.000Z",
    });
  });

	it("marks a plan-changed webhook as a scheduled cancellation when Dodo sets the cancel flag", () => {
		expect(
			extractDodoSubscriptionGrant(
				env,
				subscriptionPayload("subscription.plan_changed", {
					cancel_at_next_billing_date: true,
				}),
			),
		).toMatchObject({
			eventType: "subscription.plan_changed",
			status: "active",
			cancellationScheduled: true,
			nextBillingAt: "2026-08-12T05:30:00.000Z",
		});
	});

  it.each([
    [false, false],
    [null, null],
    ["missing", null],
  ])("preserves an explicit, null, or missing cancellation flag (%s)", (value, expected) => {
    const overrides = value === "missing" ? { cancel_at_next_billing_date: undefined } : {
      cancel_at_next_billing_date: value,
    };
    expect(
      extractDodoSubscriptionGrant(
        env,
        subscriptionPayload("subscription.updated", overrides),
      ),
    ).toMatchObject({
      eventType: "subscription.updated",
      cancellationScheduled: expected,
    });
  });

	  it("does not use previous billing date or subscription creation as the plan-changed event timestamp", () => {
	    const grant = extractDodoSubscriptionGrant(
	      env,
	      subscriptionPayload("subscription.plan_changed", { updated_at: "" }),
	    );

	    expect(grant).toMatchObject({
	      grantedAt: null,
	      hasProviderGrantTimestamp: false,
	    });
	  });

  it("ignores unknown subscription product ids even with trusted plan metadata", () => {
    const grant = extractDodoSubscriptionGrant(
      { DODO_0509_BRAND_ID: "brand_0509" } as never,
      subscriptionPayload("subscription.renewed", { product_id: "pdt_unmapped" }),
    );

    expect(grant).toBeNull();
  });

  it("recovers subscription product identity from trusted SKU metadata when product id is absent", () => {
    const grant = extractDodoSubscriptionGrant(
      env,
      subscriptionPayload("subscription.renewed", {
        product_id: "",
        metadata: {
          app: "0509",
          user_id: "user-1",
          target_kind: "plan",
          sku: "starter_monthly_v1",
          plan: "starter",
          cycle: "monthly",
        },
      }),
    );

    expect(grant).toMatchObject({
      productId: "pdt_starter_monthly",
      plan: "starter",
      cycle: "monthly",
    });
  });

  it("does not treat failed one-time top-ups as subscription payment issues", () => {
    expect(
      extractDodoPlanRevocation(
        env,
        {
          type: "payment.failed",
          data: {
            payload_type: "Payment",
            id: "pay_top_up_failed",
            brand_id: "brand_0509",
            status: "failed",
            product_cart: [{ product_id: "prod_pack_500" }],
            subscription_id: "",
            metadata: {
              app: "0509",
              user_id: "user-1",
              target_kind: "top_up",
              sku: "burst_500_v1",
            },
          },
        },
      ),
    ).toBeNull();
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

  it("ignores subscription grants for configured top-up products even with trusted metadata", () => {
    const grant = extractDodoSubscriptionGrant(
      {
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      } as never,
      subscriptionPayload("subscription.renewed", {
        product_id: "prod_pack_500",
      }),
    );

    expect(grant).toBeNull();
  });

  it.each([
    ["is_subscription", false],
    ["is_recurring", false],
  ])("ignores subscription grants when %s is false", (field, value) => {
    const grant = extractDodoSubscriptionGrant(
      env,
      subscriptionPayload("subscription.renewed", {
        [field]: value,
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

  it("routes an immediate subscription.updated cancellation to revocation", () => {
    const payload = subscriptionPayload("subscription.updated", {
      status: "cancelled",
      cancel_at_next_billing_date: false,
      cancelled_at: "2026-07-14T08:00:00.000Z",
    });

    expect(extractDodoSubscriptionGrant(env, payload)).toBeNull();
    expect(extractDodoPlanRevocation(env, payload)).toMatchObject({
      eventType: "subscription.updated",
      action: "revoke",
      subscriptionId: "sub_123",
      revokedAt: "2026-07-14T08:00:00.000Z",
    });
  });
});
