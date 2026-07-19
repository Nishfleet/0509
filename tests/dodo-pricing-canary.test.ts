import { describe, expect, it, vi } from "vitest";

import { fetchPreview, validatePricingPreviewBody } from "../scripts/dodo-pricing-canary.mjs";

function pricingPreview(overrides: Record<string, unknown> = {}) {
  const planPrice = (country = "US") => ({
    monthly: { display: "$49/mo", currency: "USD", billingCountry: country },
    yearly: { display: "$392/yr", currency: "USD", billingCountry: country },
  });
  const base = {
    available: true,
    country: "US",
    prices: {
      scout: planPrice(),
      starter: planPrice(),
      agency: planPrice(),
    },
    annualValidation: {
      scout: {
        valid: true,
        reason: "valid_4_months_free",
        monthlyAmount: 4900,
        annualAmount: 39200,
        expectedAnnualAmount: 39200,
        currency: "USD",
        billingCountry: "US",
      },
      starter: {
        valid: true,
        reason: "valid_4_months_free",
        monthlyAmount: 4900,
        annualAmount: 39200,
        expectedAnnualAmount: 39200,
        currency: "USD",
        billingCountry: "US",
      },
      agency: {
        valid: true,
        reason: "valid_4_months_free",
        monthlyAmount: 4900,
        annualAmount: 39200,
        expectedAnnualAmount: 39200,
        currency: "USD",
        billingCountry: "US",
      },
    },
    usageBundles: {
      proof_500: { display: "$25", currency: "USD", billingCountry: "US" },
      proof_2000: { display: "$80", currency: "USD", billingCountry: "US" },
      proof_7500: { display: "$240", currency: "USD", billingCountry: "US" },
    },
    commercialLaunch: {
      scoutSaleOpen: true,
      starterSaleOpen: true,
      agencySaleOpen: true,
    },
  };
  return {
    ...base,
    ...overrides,
    prices: {
      ...base.prices,
      ...((overrides.prices as typeof base.prices | undefined) ?? {}),
    },
    annualValidation: {
      ...base.annualValidation,
      ...((overrides.annualValidation as typeof base.annualValidation | undefined) ?? {}),
    },
    usageBundles: {
      ...base.usageBundles,
      ...((overrides.usageBundles as typeof base.usageBundles | undefined) ?? {}),
    },
    commercialLaunch: {
      ...base.commercialLaunch,
      ...((overrides.commercialLaunch as typeof base.commercialLaunch | undefined) ?? {}),
    },
  };
}

describe("Dodo pricing canary script", () => {
  it("passes only when sale-open monthly and annual prices validate", () => {
    const result = validatePricingPreviewBody({
      preview: pricingPreview(),
      requestedCountry: "US",
      status: 200,
      responseOk: true,
    });

    expect(result.ok).toBe(true);
    expect(result.planValidations).toEqual([
      expect.objectContaining({ plan: "scout", ok: true }),
      expect.objectContaining({ plan: "starter", ok: true }),
      expect.objectContaining({ plan: "agency", ok: true }),
    ]);
    expect(result.topUpValidations).toEqual([
      expect.objectContaining({ bundle: "proof_500", ok: true }),
      expect.objectContaining({ bundle: "proof_2000", ok: true }),
      expect.objectContaining({ bundle: "proof_7500", ok: true }),
    ]);
  });

  it("requires the response to match the exact deployed Worker when version-bound", () => {
    const matching = validatePricingPreviewBody({
      preview: pricingPreview({ workerVersionId: "worker-v1" }),
      requestedCountry: "US",
      status: 200,
      responseOk: true,
      expectedWorkerVersionId: "worker-v1",
    });
    const drifted = validatePricingPreviewBody({
      preview: pricingPreview({ workerVersionId: "worker-v2" }),
      requestedCountry: "US",
      status: 200,
      responseOk: true,
      expectedWorkerVersionId: "worker-v1",
    });

    expect(matching.ok).toBe(true);
    expect(matching.workerVersionId).toBe("worker-v1");
    expect(drifted.ok).toBe(false);
  });

  it("rejects an unbound direct fetch before making a request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(fetchPreview({
      baseUrl: "https://0509.io",
      country: "US",
      token: "canary-token",
      expectedWorkerVersionId: "",
    })).rejects.toThrow("pricing_canary_worker_version_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips Agency validation when the commercial launch gate is closed", () => {
    const result = validatePricingPreviewBody({
      preview: pricingPreview({
        commercialLaunch: {
          agencySaleOpen: false,
        },
        prices: {
          agency: {
            monthly: null,
            yearly: null,
          },
        },
        annualValidation: {
          agency: {
            valid: false,
            reason: "missing_price",
          },
        },
      }),
      requestedCountry: "US",
      status: 200,
      responseOk: true,
    });

    expect(result.ok).toBe(true);
    expect(result.planValidations).toEqual([
      expect.objectContaining({ plan: "scout", ok: true }),
      expect.objectContaining({ plan: "starter", ok: true }),
    ]);
  });

  it.each([
    [
      "missing monthly price",
      {
        prices: {
          scout: { monthly: null, yearly: { display: "$392/yr", currency: "USD", billingCountry: "US" } },
          starter: pricingPreview().prices.starter,
        },
      },
      "missing monthly price",
    ],
    [
      "missing annual price",
      {
        prices: {
          scout: { monthly: { display: "$49/mo", currency: "USD", billingCountry: "US" }, yearly: null },
          starter: pricingPreview().prices.starter,
        },
      },
      "missing annual price",
    ],
    [
      "invalid annual validation",
      {
        annualValidation: {
          ...pricingPreview().annualValidation,
          scout: {
            ...pricingPreview().annualValidation.scout,
            valid: false,
            reason: "amount_mismatch",
          },
        },
      },
      "annual validation failed",
    ],
    [
      "country mismatch",
      {
        prices: {
          scout: {
            monthly: { display: "$49/mo", currency: "USD", billingCountry: "GB" },
            yearly: { display: "$392/yr", currency: "USD", billingCountry: "US" },
          },
          starter: pricingPreview().prices.starter,
        },
      },
      "monthly country GB",
    ],
    [
      "missing monthly billing country",
      {
        prices: {
          scout: {
            monthly: { display: "$49/mo", currency: "USD" },
            yearly: { display: "$392/yr", currency: "USD", billingCountry: "US" },
          },
          starter: pricingPreview().prices.starter,
        },
      },
      "missing monthly country",
    ],
    [
      "monthly and annual currency mismatch",
      {
        prices: {
          scout: {
            monthly: { display: "$49/mo", currency: "USD", billingCountry: "US" },
            yearly: { display: "£392/yr", currency: "GBP", billingCountry: "US" },
          },
          starter: pricingPreview().prices.starter,
        },
      },
      "annual currency GBP",
    ],
    [
      "annual validation currency mismatch",
      {
        annualValidation: {
          ...pricingPreview().annualValidation,
          scout: {
            ...pricingPreview().annualValidation.scout,
            currency: "GBP",
          },
        },
      },
      "annual validation currency GBP",
    ],
    [
      "annual amount mismatch",
      {
        annualValidation: {
          ...pricingPreview().annualValidation,
          scout: {
            ...pricingPreview().annualValidation.scout,
            annualAmount: 49100,
          },
        },
      },
      "annual amount is not monthly x 8",
    ],
  ])("fails on %s", (_name, overrides, expectedFailure) => {
    const result = validatePricingPreviewBody({
      preview: pricingPreview(overrides),
      requestedCountry: "US",
      status: 200,
      responseOk: true,
    });

    expect(result.ok).toBe(false);
    expect(result.planValidations[0]?.failures).toContain(expectedFailure);
  });

  it.each([
    [
      "missing top-up price",
      {
        usageBundles: {
          ...pricingPreview().usageBundles,
          proof_500: null,
        },
      },
      "missing bundle price",
    ],
    [
      "missing top-up currency",
      {
        usageBundles: {
          ...pricingPreview().usageBundles,
          proof_500: { display: "$25", billingCountry: "US" },
        },
      },
      "missing bundle currency",
    ],
    [
      "top-up country mismatch",
      {
        usageBundles: {
          ...pricingPreview().usageBundles,
          proof_500: { display: "$25", currency: "USD", billingCountry: "GB" },
        },
      },
      "bundle country GB",
    ],
  ])("fails on %s", (_name, overrides, expectedFailure) => {
    const result = validatePricingPreviewBody({
      preview: pricingPreview(overrides),
      requestedCountry: "US",
      status: 200,
      responseOk: true,
    });

    expect(result.ok).toBe(false);
    expect(result.topUpValidations[0]?.failures).toContain(expectedFailure);
  });
});
