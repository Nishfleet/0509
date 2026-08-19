import { describe, expect, it, vi } from "vitest";

import {
  previewDodo0509PlanPrices,
  validateDodo0509PlanCheckout,
  validateDodo0509TopUpCheckout,
} from "~/lib/dodo-pricing.server";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", ...init.headers },
    ...init,
  });
}

describe("Dodo 0509 checkout pricing validation", () => {
  it("accepts adaptive-currency rounding in the 4-months-free annual validation", async () => {
    // Live Dodo previews in adaptive currencies (observed 2026-08-11 in EUR)
    // compute the annual tax-inclusive total per line, so the annual amount
    // can differ from monthly x 8 by 1-2 minor units of conversion rounding
    // (908 x 8 = 7264 vs an annual total of 7262). That must still validate
    // as "4 months free"; only meaningful drift (e.g. 8x + a real amount)
    // must fail closed.
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      const amounts: Record<string, number> = {
        prod_scout_monthly: 908,
        prod_scout_yearly: 7262,
      };
      const amount = amounts[productId] ?? 0;
      return jsonResponse({
        currency: "EUR",
        billing_country: "DE",
        current_breakup: {
          total_amount: amount,
        },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: amount,
            tax_inclusive: true,
          },
        ],
        total_tax: 0,
      });
    });
    const env = {
      DODO_0509_API_KEY: "secret",
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_ENVIRONMENT: "test",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
    };
    const request = new Request("https://0509.io/", {
      headers: { "cf-ipcountry": "DE" },
    });

    const preview = await previewDodo0509PlanPrices({
      env,
      request,
      fetcher: fetcher as never,
      bypassCache: true,
    });

    expect(preview.annualValidation.scout).toMatchObject({
      valid: true,
      reason: "valid_4_months_free",
      monthlyAmount: 908,
      annualAmount: 7262,
      expectedAnnualAmount: 7264,
      currency: "EUR",
      billingCountry: "DE",
    });
  });

  it("still fails the 4-months-free annual validation on meaningful drift", async () => {
    // Annual = 8x monthly plus a real amount (one extra month) must stay
    // invalid: the rounding allowance is tiny and cannot mask a mispriced
    // annual SKU.
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      const amounts: Record<string, number> = {
        prod_scout_monthly: 908,
        prod_scout_yearly: 8180,
      };
      const amount = amounts[productId] ?? 0;
      return jsonResponse({
        currency: "EUR",
        billing_country: "DE",
        current_breakup: {
          total_amount: amount,
        },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: amount,
            tax_inclusive: true,
          },
        ],
        total_tax: 0,
      });
    });
    const env = {
      DODO_0509_API_KEY: "secret",
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_ENVIRONMENT: "test",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
    };
    const request = new Request("https://0509.io/", {
      headers: { "cf-ipcountry": "DE" },
    });

    const preview = await previewDodo0509PlanPrices({
      env,
      request,
      fetcher: fetcher as never,
      bypassCache: true,
    });

    expect(preview.annualValidation.scout).toMatchObject({
      valid: false,
      reason: "amount_mismatch",
      monthlyAmount: 908,
      annualAmount: 8180,
      expectedAnnualAmount: 7264,
    });
  });

  it("validates annual savings against product price, not tax-inclusive checkout totals", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      const prices: Record<string, { product: number; total: number }> = {
        prod_scout_monthly: { product: 1000, total: 1100 },
        prod_scout_yearly: { product: 8000, total: 8817 },
      };
      const price = prices[productId] ?? { product: 0, total: 0 };
      return jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: {
          total_amount: price.total,
        },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: price.product,
            tax_inclusive: false,
          },
        ],
        total_tax: price.total - price.product,
      });
    });
    const env = {
      DODO_0509_API_KEY: "secret",
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_ENVIRONMENT: "test",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
    };
    const request = new Request("https://0509.io/app/billing", {
      headers: { "cf-ipcountry": "US" },
    });

    const preview = await previewDodo0509PlanPrices({ env, request, fetcher: fetcher as never });

    expect(preview.prices.scout?.monthly).toMatchObject({
      amount: 1100,
      validationAmount: 1000,
      display: "$11",
    });
    expect(preview.annualValidation.scout).toMatchObject({
      valid: true,
      reason: "valid_4_months_free",
      monthlyAmount: 1000,
      annualAmount: 8000,
      expectedAnnualAmount: 8000,
    });
    await expect(
      validateDodo0509PlanCheckout({
        env,
        request,
        plan: "scout",
        cycle: "monthly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: true,
      reason: "valid_preview",
      price: {
        amount: 1100,
        validationAmount: 1000,
      },
      pricingContext: {
        billingCountry: "US",
        billingCurrency: "USD",
      },
    });
    await expect(
      validateDodo0509PlanCheckout({
        env,
        request,
        plan: "scout",
        cycle: "yearly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: true,
      reason: "valid_preview",
      pricingContext: {
        billingCountry: "US",
        billingCurrency: "USD",
      },
    });
  });

  it("validates monthly checkout against Dodo preview and annual savings against eight monthly periods", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      const amounts: Record<string, number> = {
        prod_scout_monthly: 1000,
        prod_scout_yearly: 8000,
        prod_starter_monthly: 5900,
        prod_starter_yearly: 50000,
      };
      return jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: {
          total_amount: amounts[productId] ?? 0,
        },
        product_cart: [{ product_id: productId, is_subscription: true, tax_inclusive: false }],
        total_tax: 0,
      });
    });
    const env = {
      DODO_0509_API_KEY: "secret",
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_ENVIRONMENT: "test",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
      DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
      DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
    };
    const request = new Request("https://0509.io/app/billing", {
      headers: { "cf-ipcountry": "US" },
    });

    const preview = await previewDodo0509PlanPrices({ env, request, fetcher: fetcher as never });

    expect(preview.annualValidation.scout).toMatchObject({
      valid: true,
      reason: "valid_4_months_free",
      monthlyAmount: 1000,
      annualAmount: 8000,
      expectedAnnualAmount: 8000,
      currency: "USD",
      billingCountry: "US",
    });
    expect(preview.annualValidation.starter).toMatchObject({
      valid: false,
      reason: "amount_mismatch",
      monthlyAmount: 5900,
      annualAmount: 50000,
      expectedAnnualAmount: 47200,
    });

    await expect(
      validateDodo0509PlanCheckout({
        env,
        request,
        plan: "scout",
        cycle: "monthly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: true,
      reason: "valid_preview",
      planId: "scout",
      cycle: "monthly",
    });
    await expect(
      validateDodo0509PlanCheckout({
        env,
        request,
        plan: "starter",
        cycle: "yearly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: false,
      reason: "amount_mismatch",
      planId: "starter",
      cycle: "yearly",
    });
  });

  it("validates monthly checkout with only the selected Dodo SKU and ignores spoofable country headers", async () => {
    const seenProductIds: string[] = [];
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      seenProductIds.push(productId);
      expect(productId).toBe("prod_scout_monthly");
      expect(body.billing_address).toEqual({ country: "US" });
      return jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: 1900 },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: 1900,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });
    const request = new Request("https://0509.io/app/billing", {
      headers: {
        "cf-ipcountry": "IN",
        "x-country": "GB",
      },
    }) as Request & { cf?: { country?: string } };
    request.cf = { country: "US" };

    const validation = await validateDodo0509PlanCheckout({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
        DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
      },
      request,
      plan: "scout",
      cycle: "monthly",
      fetcher: fetcher as never,
    });

    expect(seenProductIds).toEqual(["prod_scout_monthly"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(validation).toMatchObject({
      valid: true,
      reason: "valid_preview",
      pricingContext: {
        billingCountry: "US",
        billingCurrency: "USD",
      },
    });
  });

  it("blocks monthly checkout when the fresh Dodo preview returns a different product", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: 1900 },
        product_cart: [
          {
            product_id: "prod_other_monthly",
            is_subscription: true,
            discounted_price: 1900,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      }),
    );
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    await expect(
      validateDodo0509PlanCheckout({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_BRAND_ID: "brand_0509",
          DODO_0509_ENVIRONMENT: "test",
          DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
        },
        request,
        plan: "scout",
        cycle: "monthly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: false,
      reason: "product_mismatch",
    });
  });

  it("blocks monthly checkout when Dodo returns a different billing country than the trusted request", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        currency: "USD",
        billing_country: "GB",
        current_breakup: { total_amount: 1900 },
        product_cart: [
          {
            product_id: "prod_scout_monthly",
            is_subscription: true,
            discounted_price: 1900,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      }),
    );
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    await expect(
      validateDodo0509PlanCheckout({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_BRAND_ID: "brand_0509",
          DODO_0509_ENVIRONMENT: "test",
          DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
        },
        request,
        plan: "scout",
        cycle: "monthly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: false,
      reason: "billing_context_mismatch",
      pricingContext: {
        billingCountry: "GB",
        billingCurrency: "USD",
      },
    });
  });

  it("validates annual checkout with only the selected annual SKU and its monthly comparison", async () => {
    const seenProductIds: string[] = [];
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      seenProductIds.push(productId);
      const amounts: Record<string, number> = {
        prod_starter_yearly: 47200,
        prod_starter_monthly: 5900,
      };
      if (!(productId in amounts)) {
        throw new Error(`Unexpected product ${productId}`);
      }
      return jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: amounts[productId] },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: amounts[productId],
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    const validation = await validateDodo0509PlanCheckout({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
        DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
      },
      request,
      plan: "starter",
      cycle: "yearly",
      fetcher: fetcher as never,
    });

    expect(seenProductIds).toEqual(["prod_starter_yearly", "prod_starter_monthly"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(validation).toMatchObject({
      valid: true,
      reason: "valid_preview",
      annualValidation: {
        valid: true,
        reason: "valid_4_months_free",
        monthlyAmount: 5900,
        annualAmount: 47200,
      },
    });
  });

  it("blocks annual checkout when the selected annual preview returns the wrong trusted billing country", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        currency: "USD",
        billing_country: "GB",
        current_breakup: { total_amount: 47200 },
        product_cart: [
          {
            product_id: "prod_starter_yearly",
            is_subscription: true,
            discounted_price: 47200,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      }),
    );
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    const validation = await validateDodo0509PlanCheckout({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
      },
      request,
      plan: "starter",
      cycle: "yearly",
      fetcher: fetcher as never,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(validation).toMatchObject({
      valid: false,
      reason: "billing_context_mismatch",
      annualValidation: {
        valid: false,
        reason: "billing_context_mismatch",
        annualAmount: 47200,
        billingCountry: "GB",
      },
    });
  });

  it("blocks annual checkout when the monthly comparison preview returns the wrong trusted billing country", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      return jsonResponse({
        currency: "USD",
        billing_country: productId === "prod_starter_monthly" ? "GB" : "US",
        current_breakup: { total_amount: productId === "prod_starter_monthly" ? 5900 : 47200 },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: productId === "prod_starter_monthly" ? 5900 : 47200,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    const validation = await validateDodo0509PlanCheckout({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
      },
      request,
      plan: "starter",
      cycle: "yearly",
      fetcher: fetcher as never,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(validation).toMatchObject({
      valid: false,
      reason: "billing_context_mismatch",
      annualValidation: {
        valid: false,
        reason: "billing_context_mismatch",
        monthlyAmount: 5900,
        annualAmount: 47200,
        billingCountry: "US",
      },
    });
  });

  it.each([
    {
      name: "selected annual product id drifts",
      productId: "prod_starter_yearly",
      responseProductId: "prod_other_yearly",
      responseIsSubscription: true,
      expectedReason: "product_mismatch",
      expectedSeen: ["prod_starter_yearly"],
    },
    {
      name: "selected annual product is not a subscription",
      productId: "prod_starter_yearly",
      responseProductId: "prod_starter_yearly",
      responseIsSubscription: false,
      expectedReason: "product_type_mismatch",
      expectedSeen: ["prod_starter_yearly"],
    },
    {
      name: "monthly comparison product id drifts",
      productId: "prod_starter_monthly",
      responseProductId: "prod_other_monthly",
      responseIsSubscription: true,
      expectedReason: "product_mismatch",
      expectedSeen: ["prod_starter_yearly", "prod_starter_monthly"],
    },
    {
      name: "monthly comparison product is not a subscription",
      productId: "prod_starter_monthly",
      responseProductId: "prod_starter_monthly",
      responseIsSubscription: false,
      expectedReason: "product_type_mismatch",
      expectedSeen: ["prod_starter_yearly", "prod_starter_monthly"],
    },
  ])("blocks annual checkout when $name", async (caseData) => {
    const seenProductIds: string[] = [];
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      seenProductIds.push(productId);
      const normalAmounts: Record<string, number> = {
        prod_starter_yearly: 47200,
        prod_starter_monthly: 5900,
      };
      const responseProductId =
        productId === caseData.productId ? caseData.responseProductId : productId;
      const responseIsSubscription =
        productId === caseData.productId ? caseData.responseIsSubscription : true;
      return jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: normalAmounts[productId] ?? 0 },
        product_cart: [
          {
            product_id: responseProductId,
            is_subscription: responseIsSubscription,
            discounted_price: normalAmounts[productId] ?? 0,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    const validation = await validateDodo0509PlanCheckout({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
      },
      request,
      plan: "starter",
      cycle: "yearly",
      fetcher: fetcher as never,
    });

    expect(seenProductIds).toEqual(caseData.expectedSeen);
    expect(validation).toMatchObject({
      valid: false,
      reason: caseData.expectedReason,
      annualValidation: {
        valid: false,
        reason: caseData.expectedReason,
      },
    });
  });

  it("validates top-up checkout against the selected one-time Dodo product preview", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      expect(productId).toBe("prod_pack_500");
      return jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: 2500 },
        product_cart: [
          {
            product_id: productId,
            is_subscription: false,
            discounted_price: 2500,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    const validation = await validateDodo0509TopUpCheckout({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      },
      request,
      sku: "burst_500_v1",
      fetcher: fetcher as never,
    });

    expect(validation).toMatchObject({
      valid: true,
      reason: "valid_preview",
      bundleId: "proof_500",
      pricingContext: {
        billingCountry: "US",
        billingCurrency: "USD",
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("blocks top-up checkout when Dodo returns a different billing country than the trusted request", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        currency: "USD",
        billing_country: "GB",
        current_breakup: { total_amount: 2500 },
        product_cart: [
          {
            product_id: "prod_pack_500",
            is_subscription: false,
            discounted_price: 2500,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      }),
    );
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    await expect(
      validateDodo0509TopUpCheckout({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_BRAND_ID: "brand_0509",
          DODO_0509_ENVIRONMENT: "test",
          DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
        },
        request,
        sku: "burst_500_v1",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: false,
      reason: "billing_context_mismatch",
      pricingContext: {
        billingCountry: "GB",
        billingCurrency: "USD",
      },
    });
  });

  it("blocks top-up checkout when the Dodo preview returns a subscription product", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: 2500 },
        product_cart: [
          {
            product_id: "prod_pack_500",
            is_subscription: true,
            discounted_price: 2500,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      }),
    );

    await expect(
      validateDodo0509TopUpCheckout({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_BRAND_ID: "brand_0509",
          DODO_0509_ENVIRONMENT: "test",
          DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
        },
        request: new Request("https://0509.io/app/billing"),
        sku: "burst_500_v1",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: false,
      reason: "product_type_mismatch",
    });
  });

  it("does not cache partial Dodo pricing preview failures", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      const productId = body.product_cart?.[0]?.product_id;
      if (productId === "prod_starter_monthly") {
        return jsonResponse({ message: "preview failed" }, { status: 502 });
      }
      return jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: 1900 },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: 1900,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });
    const env = {
      DODO_0509_API_KEY: "secret",
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_ENVIRONMENT: "test",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_cache_scout_monthly",
      DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
    };
    const request = new Request("https://0509.io/app/billing") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    const firstPreview = await previewDodo0509PlanPrices({ env, request, fetcher: fetcher as never });
    const secondPreview = await previewDodo0509PlanPrices({ env, request, fetcher: fetcher as never });

    expect(firstPreview.available).toBe(true);
    expect(firstPreview.prices.scout?.monthly).toBeDefined();
    expect(firstPreview.prices.starter?.monthly).toBeUndefined();
    expect(secondPreview.prices.scout?.monthly).toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("reports missing annual SKUs before starting annual checkout validation", async () => {
    const fetcher = vi.fn();
    const validation = await validateDodo0509PlanCheckout({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      },
      request: new Request("https://0509.io/app/billing"),
      plan: "scout",
      cycle: "yearly",
      fetcher: fetcher as never,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(validation).toMatchObject({
      valid: false,
      reason: "missing_annual_price",
      annualValidation: {
        valid: false,
        reason: "missing_annual_price",
      },
    });
  });

  it("reports missing monthly comparison prices during annual checkout validation", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: 15200 },
        product_cart: [
          {
            product_id: "prod_scout_yearly",
            is_subscription: true,
            discounted_price: 15200,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      }),
    );

    const validation = await validateDodo0509PlanCheckout({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
      },
      request: new Request("https://0509.io/app/billing"),
      plan: "scout",
      cycle: "yearly",
      fetcher: fetcher as never,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(validation).toMatchObject({
      valid: false,
      reason: "missing_monthly_price",
      annualValidation: {
        valid: false,
        reason: "missing_monthly_price",
        annualAmount: 15200,
      },
    });
  });

  it("blocks annual checkout when monthly and annual Dodo previews resolve different currencies", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      return jsonResponse({
        currency: productId === "prod_scout_yearly" ? "INR" : "USD",
        billing_country: "US",
        current_breakup: { total_amount: productId === "prod_scout_yearly" ? 15200 : 1900 },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: productId === "prod_scout_yearly" ? 15200 : 1900,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });

    await expect(
      validateDodo0509PlanCheckout({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_BRAND_ID: "brand_0509",
          DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
          DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
        },
        request: new Request("https://0509.io/app/billing"),
        plan: "scout",
        cycle: "yearly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: false,
      reason: "currency_mismatch",
    });
  });

  it("blocks annual checkout when monthly and annual Dodo previews resolve different billing countries", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      return jsonResponse({
        currency: "USD",
        billing_country: productId === "prod_scout_yearly" ? "GB" : "US",
        current_breakup: { total_amount: productId === "prod_scout_yearly" ? 15200 : 1900 },
        product_cart: [
          {
            product_id: productId,
            is_subscription: true,
            discounted_price: productId === "prod_scout_yearly" ? 15200 : 1900,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });

    await expect(
      validateDodo0509PlanCheckout({
        env: {
          DODO_0509_API_KEY: "secret",
          DODO_0509_BRAND_ID: "brand_0509",
          DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
          DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
        },
        request: new Request("https://0509.io/app/billing"),
        plan: "scout",
        cycle: "yearly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      valid: false,
      reason: "billing_context_mismatch",
    });
  });
});
