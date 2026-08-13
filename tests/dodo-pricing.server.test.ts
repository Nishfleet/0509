import { describe, expect, it, vi } from "vitest";

import {
  dodo0509BaseUrl,
  dodo0509ProductIds,
  dodo0509UsageBundleProductIds,
  hasDodo0509Pricing,
  previewDodo0509PlanPrices,
  validateDodo0509PlanCheckout,
} from "~/lib/dodo-pricing.server";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", ...init.headers },
    ...init,
  });
}

describe("Dodo 0509 pricing", () => {
  it("requires a Dodo account key, 0509 brand, and 0509 product ids", () => {
    expect(hasDodo0509Pricing({})).toBe(false);
    expect(
      hasDodo0509Pricing({
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      }),
    ).toBe(true);
    expect(
      hasDodo0509Pricing({
        DODO_PAYMENTS_API_KEY: "shared-account-secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      }),
    ).toBe(true);
    expect(
      hasDodo0509Pricing({
        DODO_PAYMENTS_API_KEY: "shared-account-secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      }),
    ).toBe(true);
  });

  it("keeps Dodo product ids brand scoped", () => {
    expect(
      dodo0509ProductIds({
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
        DODO_0509_PRODUCT_SCOUT_YEARLY_ID: "prod_scout_yearly",
        DODO_0509_PRODUCT_AGENCY_MONTHLY_ID: "prod_agency_monthly",
        DODO_0509_PRODUCT_AGENCY_YEARLY_ID: "prod_agency_yearly",
      }),
    ).toEqual({
      scout: {
        monthly: "prod_scout_monthly",
        yearly: "prod_scout_yearly",
      },
      starter: {
        monthly: "prod_starter_monthly",
        yearly: "prod_starter_yearly",
      },
      agency: {
        monthly: "prod_agency_monthly",
        yearly: "prod_agency_yearly",
      },
    });
    expect(
      dodo0509UsageBundleProductIds({
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
        DODO_0509_PRODUCT_PROOF_PACK_2000_ID: "prod_pack_2000",
        DODO_0509_PRODUCT_PROOF_PACK_7500_ID: "prod_pack_7500",
      }),
    ).toEqual({
      proof_500: "prod_pack_500",
      proof_2000: "prod_pack_2000",
      proof_7500: "prod_pack_7500",
    });
  });

  it("uses live Dodo by default and test Dodo when explicitly configured", () => {
    expect(dodo0509BaseUrl({})).toBe("https://live.dodopayments.com");
    expect(dodo0509BaseUrl({ DODO_0509_ENVIRONMENT: "test" })).toBe("https://test.dodopayments.com");
  });

  it("previews configured products through Dodo checkout preview", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      return jsonResponse({
        currency: "INR",
        current_breakup: {
          total_amount: 499900,
        },
        product_cart: [{ product_id: productId, is_subscription: productId !== "prod_pack_500", tax_inclusive: true }],
        total_tax: 0,
      });
    });

    const preview = await previewDodo0509PlanPrices({
      env: {
        DODO_0509_ADAPTIVE_CURRENCY_FEES_INCLUSIVE: "true",
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      },
      request: new Request("https://0509.io/api/pricing-preview", {
        headers: { "cf-ipcountry": "IN" },
      }),
      fetcher: fetcher as never,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://test.dodopayments.com/checkouts/preview",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      product_cart: [{ product_id: "prod_scout_monthly", quantity: 1 }],
      adaptive_currency_fees_inclusive: true,
      billing_address: { country: "IN" },
    });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      product_cart: [{ product_id: "prod_starter_monthly", quantity: 1 }],
      adaptive_currency_fees_inclusive: true,
      billing_address: { country: "IN" },
    });
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      product_cart: [{ product_id: "prod_pack_500", quantity: 1 }],
      adaptive_currency_fees_inclusive: true,
      billing_address: { country: "IN" },
    });
    expect(preview).toMatchObject({
      available: true,
      provider: "dodo",
      source: "dodo_checkout_preview",
      country: "IN",
      prices: {
        scout: {
          monthly: {
            amount: 499900,
            currency: "INR",
            display: "₹4,999",
            planId: "scout",
            cycle: "monthly",
          },
        },
        starter: {
          monthly: {
            amount: 499900,
            currency: "INR",
            display: "₹4,999",
            planId: "starter",
            cycle: "monthly",
          },
        },
      },
      usageBundles: {
        proof_500: {
          amount: 499900,
          validationAmount: 499900,
          currency: "INR",
          display: "₹4,999",
          bundleId: "proof_500",
        },
      },
    });
  });

  it("does not expose Dodo product ids in display previews", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        currency: "USD",
        current_breakup: { total_amount: 1100 },
        billing_country: "US",
        product_cart: [
          {
            product_id: "prod_scout_monthly",
            is_subscription: true,
            tax_inclusive: false,
          },
        ],
      }),
    );

    const preview = await previewDodo0509PlanPrices({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      },
      request: new Request("https://0509.io/api/pricing-preview", {
        headers: { "cf-ipcountry": "US" },
      }),
      fetcher: fetcher as never,
    });

    expect(preview.prices.scout?.monthly?.display).toBe("$11");
    expect(JSON.stringify(preview)).not.toContain("prod_scout_monthly");
    expect(preview.prices.scout?.monthly).not.toHaveProperty("productId");
  });

  it("filters Dodo display previews that return a different billing country", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      return jsonResponse({
        currency: "USD",
        current_breakup: { total_amount: 1100 },
        billing_country: productId === "prod_pack_500" ? "US" : "GB",
        product_cart: [
          {
            product_id: productId,
            is_subscription: productId !== "prod_pack_500",
            discounted_price: 1100,
            tax_inclusive: false,
          },
        ],
        total_tax: 0,
      });
    });

    const request = new Request("https://0509.io/api/pricing-preview") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };
    const preview = await previewDodo0509PlanPrices({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
        DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_pack_500",
      },
      request,
      fetcher: fetcher as never,
    });

    expect(preview.country).toBe("US");
    expect(preview.prices.scout?.monthly).toBeUndefined();
    expect(preview.usageBundles.proof_500).toMatchObject({
      billingCountry: "US",
      currency: "USD",
    });
  });

  it("does not cache filtered partial previews as complete", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          currency: "USD",
          current_breakup: { total_amount: 1100 },
          billing_country: "GB",
          product_cart: [
            {
              product_id: "prod_cache_country_monthly",
              is_subscription: true,
              discounted_price: 1100,
              tax_inclusive: false,
            },
          ],
          total_tax: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          currency: "USD",
          current_breakup: { total_amount: 1100 },
          billing_country: "US",
          product_cart: [
            {
              product_id: "prod_cache_country_monthly",
              is_subscription: true,
              discounted_price: 1100,
              tax_inclusive: false,
            },
          ],
          total_tax: 0,
        }),
      );

    const env = {
      DODO_0509_API_KEY: "secret",
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_ENVIRONMENT: "test",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_cache_country_monthly",
    };
    const request = new Request("https://0509.io/api/pricing-preview") as Request & {
      cf?: { country?: string };
    };
    request.cf = { country: "US" };

    const filteredPreview = await previewDodo0509PlanPrices({
      env,
      request,
      fetcher: fetcher as never,
    });
    const recoveredPreview = await previewDodo0509PlanPrices({
      env,
      request,
      fetcher: fetcher as never,
    });

    expect(filteredPreview.prices.scout?.monthly).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(recoveredPreview.prices.scout?.monthly).toMatchObject({
      billingCountry: "US",
      currency: "USD",
      display: "$11",
    });
  });

  it("bypasses the preview cache for private pricing canary requests", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
        return jsonResponse({
          currency: "INR",
          current_breakup: { total_amount: 99900 },
          product_cart: [{ product_id: productId, is_subscription: true, tax_inclusive: true }],
        });
      })
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
        return jsonResponse({
          currency: "USD",
          current_breakup: { total_amount: 1100 },
          product_cart: [{ product_id: productId, is_subscription: true, tax_inclusive: true }],
        });
      });
    const env = {
      CANARY_BYPASS_TOKEN: "canary-token",
      DODO_0509_ADAPTIVE_CURRENCY_FEES_INCLUSIVE: "true",
      DODO_0509_API_KEY: "secret",
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_ENVIRONMENT: "test",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_canary_cache",
    };

    await previewDodo0509PlanPrices({
      env,
      request: new Request("https://0509.io/api/pricing-preview", {
        headers: { "cf-ipcountry": "US" },
      }),
      fetcher: fetcher as never,
    });

    const canaryPreview = await previewDodo0509PlanPrices({
      env,
      request: new Request("https://0509.io/api/pricing-preview?country=US&pricing-canary=1", {
        headers: { "x-0509-canary-token": "canary-token" },
      }),
      fetcher: fetcher as never,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(canaryPreview.prices.scout?.monthly).toMatchObject({
      currency: "USD",
      display: "$11",
    });
  });

  it("ignores pricing country overrides without the private canary token", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      return jsonResponse({
        currency: "INR",
        current_breakup: {
          total_amount: 499900,
        },
        product_cart: [{ product_id: productId, is_subscription: true, tax_inclusive: true }],
        total_tax: 0,
      });
    });
    const request = new Request("https://0509.io/api/pricing-preview?country=US", {
      headers: {
        "cf-ipcountry": "IN",
        "x-0509-pricing-country": "GB",
      },
    });

    const preview = await previewDodo0509PlanPrices({
      env: {
        CANARY_BYPASS_TOKEN: "secret-token",
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      },
      request,
      fetcher: fetcher as never,
    });

    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      billing_address: { country: "IN" },
    });
    expect(preview.country).toBe("IN");
  });

  it("allows tokened canary pricing probes to override Cloudflare country", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      return jsonResponse({
        currency: "USD",
        current_breakup: {
          total_amount: 5900,
        },
        billing_country: "US",
        product_cart: [{ product_id: productId, is_subscription: true, tax_inclusive: false }],
        total_tax: 0,
      });
    });
    const request = new Request("https://0509.io/api/pricing-preview?country=US", {
      headers: {
        "cf-ipcountry": "IN",
        "x-0509-canary-token": "secret-token",
      },
    }) as Request & { cf?: { country?: string } };
    request.cf = { country: "IN" };

    const preview = await previewDodo0509PlanPrices({
      env: {
        CANARY_BYPASS_TOKEN: "secret-token",
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
      },
      request,
      fetcher: fetcher as never,
    });

    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      billing_address: { country: "US" },
    });
    expect(preview).toMatchObject({
      country: "US",
      prices: {
        scout: {
          monthly: {
            billingCountry: "US",
            currency: "USD",
            display: "$59",
          },
        },
      },
    });
  });

  it("keeps annual pricing unavailable when Dodo omits product identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        currency: "USD",
        current_breakup: {
          total_amount: 5900,
        },
        recurring_breakup: {
          subtotal: 5900,
        },
        billing_country: "US",
        product_cart: [{ tax_inclusive: false }],
        total_tax: 0,
      }),
    );

    const preview = await previewDodo0509PlanPrices({
      env: {
        DODO_0509_API_KEY: "secret",
        DODO_0509_BRAND_ID: "brand_0509",
        DODO_0509_ENVIRONMENT: "test",
        DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
        DODO_0509_PRODUCT_STARTER_YEARLY_ID: "prod_starter_yearly",
      },
      request: new Request("https://0509.io/api/pricing-preview", {
        headers: { "cf-ipcountry": "US" },
      }),
      fetcher: fetcher as never,
      bypassCache: true,
    });

    expect(preview.prices.starter?.monthly).toBeUndefined();
    expect(preview.prices.starter?.yearly).toBeUndefined();
    expect(preview.annualValidation.starter).toMatchObject({
      valid: false,
      reason: "missing_monthly_price",
    });
  });

  it("rejects annual savings that are not exactly eight monthly periods", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      const amounts: Record<string, number> = {
        prod_scout_monthly: 5900,
        prod_scout_yearly: 50000,
      };
      return jsonResponse({
        currency: "USD",
        billing_country: "US",
        current_breakup: { total_amount: amounts[productId] ?? 0 },
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
    };
    const request = new Request("https://0509.io/api/pricing-preview", {
      headers: { "cf-ipcountry": "US" },
    });

    const preview = await previewDodo0509PlanPrices({ env, request, fetcher: fetcher as never, bypassCache: true });

    // Both cycles resolve sellable preview prices; only the savings guard may
    // reject the pair.
    expect(preview.prices.scout?.monthly).toMatchObject({ amount: 5900, currency: "USD" });
    expect(preview.prices.scout?.yearly).toMatchObject({ amount: 50000, currency: "USD" });
    expect(preview.annualValidation.scout).toEqual({
      planId: "scout",
      valid: false,
      reason: "amount_mismatch",
      monthlyAmount: 5900,
      annualAmount: 50000,
      expectedAnnualAmount: 47200,
      currency: "USD",
      billingCountry: "US",
    });

    // The yearly checkout claim is refused with the same reason.
    await expect(
      validateDodo0509PlanCheckout({
        env,
        request,
        plan: "scout",
        cycle: "yearly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      planId: "scout",
      cycle: "yearly",
      valid: false,
      reason: "amount_mismatch",
      annualValidation: {
        planId: "scout",
        valid: false,
        reason: "amount_mismatch",
        monthlyAmount: 5900,
        annualAmount: 50000,
        expectedAnnualAmount: 47200,
      },
    });
  });

  it("rejects annual savings quoted in a different currency than monthly", async () => {
    const fetcher = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const productId = JSON.parse(String(init.body ?? "{}")).product_cart?.[0]?.product_id;
      const yearly = productId === "prod_scout_yearly";
      return jsonResponse({
        currency: yearly ? "INR" : "USD",
        billing_country: "US",
        // The amount alone satisfies the eight-month rule (47200 = 5900 * 8);
        // only the currency differs.
        current_breakup: { total_amount: yearly ? 47200 : 5900 },
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
    };
    const request = new Request("https://0509.io/api/pricing-preview", {
      headers: { "cf-ipcountry": "US" },
    });

    const preview = await previewDodo0509PlanPrices({ env, request, fetcher: fetcher as never, bypassCache: true });

    expect(preview.prices.scout?.monthly).toMatchObject({ amount: 5900, currency: "USD" });
    expect(preview.prices.scout?.yearly).toMatchObject({ amount: 47200, currency: "INR" });
    expect(preview.annualValidation.scout).toEqual({
      planId: "scout",
      valid: false,
      reason: "currency_mismatch",
      monthlyAmount: 5900,
      annualAmount: 47200,
      expectedAnnualAmount: 47200,
      currency: "INR",
      billingCountry: "US",
    });

    // The yearly checkout claim is refused with the same reason.
    await expect(
      validateDodo0509PlanCheckout({
        env,
        request,
        plan: "scout",
        cycle: "yearly",
        fetcher: fetcher as never,
      }),
    ).resolves.toMatchObject({
      planId: "scout",
      cycle: "yearly",
      valid: false,
      reason: "currency_mismatch",
      annualValidation: {
        planId: "scout",
        valid: false,
        reason: "currency_mismatch",
      },
    });
  });

  // WP-A3.3: in-app billing must resolve the buyer currency identically to the
  // public /api/pricing-preview surface. Billing used to pass
  // trustProxyHeaders: false, so a cf-ipcountry: IN browser saw ₹ on the
  // landing page but $ in billing. Both now use the default (true).
  it("resolves the same currency for billing and public preview from one cf-ipcountry geo", async () => {
    const env = {
      DODO_0509_ADAPTIVE_CURRENCY_FEES_INCLUSIVE: "true",
      DODO_0509_API_KEY: "secret",
      DODO_0509_BRAND_ID: "brand_0509",
      DODO_0509_ENVIRONMENT: "test",
      DODO_0509_PRODUCT_SCOUT_MONTHLY_ID: "prod_scout_monthly",
    };
    const makeFetcher = () =>
      vi.fn().mockResolvedValue(
        jsonResponse({
          currency: "INR",
          current_breakup: { total_amount: 499900 },
          billing_country: "IN",
          product_cart: [
            { product_id: "prod_scout_monthly", is_subscription: true, tax_inclusive: false },
          ],
        }),
      );
    const makeRequest = () =>
      new Request("https://0509.io/pricing", { headers: { "cf-ipcountry": "IN" } });

    // Public preview path (default trustProxyHeaders: true).
    const publicPreview = await previewDodo0509PlanPrices({
      env,
      request: makeRequest(),
      fetcher: makeFetcher() as never,
      bypassCache: true,
    });

    // Billing loader path — now the default too (no trustProxyHeaders override).
    const billingPreview = await previewDodo0509PlanPrices({
      env,
      request: makeRequest(),
      fetcher: makeFetcher() as never,
      bypassCache: true,
    });

    expect(publicPreview.country).toBe("IN");
    expect(billingPreview.country).toBe(publicPreview.country);
    expect(billingPreview.prices.scout?.monthly?.currency).toBe(
      publicPreview.prices.scout?.monthly?.currency,
    );
    expect(billingPreview.prices.scout?.monthly?.currency).toBe("INR");

    // The retired billing behaviour (trustProxyHeaders: false) would have
    // ignored cf-ipcountry and diverged from the public geo.
    const legacyBillingPreview = await previewDodo0509PlanPrices({
      env,
      request: makeRequest(),
      fetcher: makeFetcher() as never,
      bypassCache: true,
      trustProxyHeaders: false,
    });
    expect(legacyBillingPreview.country).not.toBe("IN");
  });
});
