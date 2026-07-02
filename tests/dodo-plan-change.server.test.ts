import { describe, expect, it, vi } from "vitest";
import {
  changeDodo0509SubscriptionPlan,
  isDefiniteDodoSubscriptionPlanChangeRejection,
  previewDodo0509SubscriptionPlanChange,
} from "~/lib/dodo-billing.server";
import type { AppEnv } from "~/lib/env.server";

const env = {
  DODO_0509_API_KEY: "dodo_test_key",
  DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
} as unknown as AppEnv;

const target = {
  kind: "plan",
  sku: "starter_monthly_v1",
  planFamily: "starter",
  cycle: "monthly",
} as const;

describe("Dodo subscription plan change", () => {
  it("previews a plan change with Dodo's documented preview endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ immediate_charge: {} }));

    await previewDodo0509SubscriptionPlanChange({
      env,
      subscriptionId: "sub_123",
      target,
      userId: "user-1",
      effectiveAt: "immediately",
      prorationBillingMode: "prorated_immediately",
      fetcher: fetcher as never,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://live.dodopayments.com/subscriptions/sub_123/change-plan/preview",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer dodo_test_key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          product_id: "prod_starter_monthly",
          proration_billing_mode: "prorated_immediately",
          quantity: 1,
          effective_at: "immediately",
          metadata: {
            app: "0509",
            user_id: "user-1",
            target_kind: "plan",
            sku: "starter_monthly_v1",
            plan: "starter",
            cycle: "monthly",
          },
          on_payment_failure: "prevent_change",
        }),
      }),
    );
  });

  it("commits a plan change with Dodo's documented change-plan endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ id: "sub_123" }));

    await changeDodo0509SubscriptionPlan({
      env,
      subscriptionId: "sub_123",
      target,
      userId: "user-1",
      effectiveAt: "next_billing_date",
      prorationBillingMode: "full_immediately",
      fetcher: fetcher as never,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://live.dodopayments.com/subscriptions/sub_123/change-plan",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          product_id: "prod_starter_monthly",
          proration_billing_mode: "full_immediately",
          quantity: 1,
          effective_at: "next_billing_date",
          metadata: {
            app: "0509",
            user_id: "user-1",
            target_kind: "plan",
            sku: "starter_monthly_v1",
            plan: "starter",
            cycle: "monthly",
          },
          on_payment_failure: "prevent_change",
        }),
      }),
    );
  });

  it("keeps retryable Dodo mutation statuses ambiguous", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ error: "busy" }, 500));

    let error: unknown;
    try {
      await changeDodo0509SubscriptionPlan({
        env,
        subscriptionId: "sub_123",
        target,
        userId: "user-1",
        effectiveAt: "immediately",
        prorationBillingMode: "prorated_immediately",
        fetcher: fetcher as never,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeTruthy();
    expect(isDefiniteDodoSubscriptionPlanChangeRejection(error)).toBe(false);
  });

  it("treats non-retryable Dodo mutation statuses as definite rejections", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ error: "bad request" }, 400));

    let error: unknown;
    try {
      await changeDodo0509SubscriptionPlan({
        env,
        subscriptionId: "sub_123",
        target,
        userId: "user-1",
        effectiveAt: "immediately",
        prorationBillingMode: "prorated_immediately",
        fetcher: fetcher as never,
      });
    } catch (caught) {
      error = caught;
    }

    expect(isDefiniteDodoSubscriptionPlanChangeRejection(error)).toBe(true);
  });

  it("classifies non-JSON non-retryable Dodo mutation statuses before parsing the body", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 422 }));

    let error: unknown;
    try {
      await changeDodo0509SubscriptionPlan({
        env,
        subscriptionId: "sub_123",
        target,
        userId: "user-1",
        effectiveAt: "immediately",
        prorationBillingMode: "prorated_immediately",
        fetcher: fetcher as never,
      });
    } catch (caught) {
      error = caught;
    }

    expect(isDefiniteDodoSubscriptionPlanChangeRejection(error)).toBe(true);
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
