import { describe, expect, it, vi } from "vitest";

import {
  dodo0509BaseUrl,
  dodo0509ProductIds,
  dodo0509UsageBundleProductIds,
  hasDodo0509Pricing,
  previewDodo0509PlanPrices,
} from "~/lib/dodo-pricing.server";

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
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        currency: "INR",
        current_breakup: {
          total_amount: 499900,
        },
        product_cart: [{ tax_inclusive: true }],
        total_tax: 0,
      }),
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
      request: new Request("https://0509.in/api/pricing-preview", {
        headers: { "cf-ipcountry": "IN" },
      }),
      fetcher: fetcher as never,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://test.dodopayments.com/checkouts/preview",
      expect.objectContaining({
        method: "POST",
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
          currency: "INR",
          display: "₹4,999",
          bundleId: "proof_500",
        },
      },
    });
  });
});
