import { describe, expect, it } from "vitest";

import { extractDodoPlanCheckoutFailure, extractDodoPlanRevocation } from "~/lib/dodo-billing.server";

const env = {
  DODO_0509_BRAND_ID: "brand_0509",
  DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
};

function planPayment(data: Record<string, unknown>, eventType = "payment.failed") {
  return {
    type: eventType,
    data: {
      payment_id: "pay_cancelled",
      brand_id: "brand_0509",
      metadata: {
        app: "0509",
        user_id: "user-1",
        target_kind: "plan",
        checkout_id: "checkout_1",
        plan: "scout",
        cycle: "monthly",
      },
      product_cart: [
        {
          product_id: "prod_scout_monthly",
          is_subscription: true,
          quantity: 1,
        },
      ],
      ...data,
    },
  };
}

function planPaymentWithoutEvent(data: Record<string, unknown>) {
  const payload = planPayment(data);
  delete (payload as { type?: string }).type;
  return payload;
}

describe("Dodo plan checkout failure extraction", () => {
  it("extracts explicit payment cancellations so the pending checkout lock can be cleared", () => {
    const failure = extractDodoPlanCheckoutFailure(
      env,
      planPayment({
        status: "payment.cancelled",
        cancelled_at: "2026-07-01T08:00:00.000Z",
      }, "payment.cancelled"),
    );

    expect(failure).toMatchObject({
      eventType: "payment.cancelled",
      userId: "user-1",
      paymentId: "pay_cancelled",
      checkoutId: "checkout_1",
      status: "payment.cancelled",
      failedAt: "2026-07-01T08:00:00.000Z",
    });
  });

  it("extracts bare cancelled payment statuses from legacy untyped payment payloads", () => {
    const failure = extractDodoPlanCheckoutFailure(
      env,
      planPaymentWithoutEvent({
        status: "cancelled",
        updated_at: "2026-07-01T08:00:00.000Z",
      }),
    );

    expect(failure).toMatchObject({
      eventType: "cancelled",
      userId: "user-1",
      paymentId: "pay_cancelled",
      checkoutId: "checkout_1",
      status: "cancelled",
      failedAt: "2026-07-01T08:00:00.000Z",
    });
  });

  it("does not swallow subscription.failed lifecycle events as checkout failures", () => {
    const failure = extractDodoPlanCheckoutFailure(env, {
      type: "subscription.failed",
      data: {
        subscription_id: "sub_failed",
        brand_id: "brand_0509",
        status: "failed",
        metadata: {
          app: "0509",
          user_id: "user-1",
          target_kind: "plan",
          plan: "scout",
          cycle: "monthly",
        },
        product_cart: [
          {
            product_id: "prod_scout_monthly",
            is_subscription: true,
            quantity: 1,
          },
        ],
      },
    });

    expect(failure).toBeNull();
  });

  it("does not swallow subscription.cancelled lifecycle events as checkout failures", () => {
    const failure = extractDodoPlanCheckoutFailure(env, {
      type: "subscription.cancelled",
      data: {
        subscription_id: "sub_cancelled",
        brand_id: "brand_0509",
        status: "cancelled",
        metadata: {
          app: "0509",
          user_id: "user-1",
          target_kind: "plan",
          plan: "scout",
          cycle: "monthly",
        },
        product_cart: [
          {
            product_id: "prod_scout_monthly",
            is_subscription: true,
            quantity: 1,
          },
        ],
      },
    });

    expect(failure).toBeNull();
  });

  it("does not clear the checkout lock for retryable payment.failed attempts", () => {
    const payload = planPayment({
      status: "failed",
      failed_at: "2026-07-01T08:00:00.000Z",
    });
    const failure = extractDodoPlanCheckoutFailure(env, payload);

    expect(failure).toBeNull();
    expect(extractDodoPlanRevocation(env, payload)).toBeNull();
  });
});
