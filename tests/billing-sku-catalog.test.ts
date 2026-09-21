import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  billingSkuForPlanCheckout,
  checkoutTargetFromSku,
  listCheckoutSkus,
  resolveBillingSku,
  resolveBillingSkuFromLegacyBundle,
  resolveBillingSkuFromProviderProductId,
  topUpQuantityForSku,
} from "~/lib/billing-sku-catalog";

describe("billing SKU catalog", () => {
  it("maps plan checkout SKUs without prices", () => {
    expect(billingSkuForPlanCheckout("starter", "monthly")).toBe("starter_monthly_v1");
    expect(billingSkuForPlanCheckout("agency", "yearly")).toBe("agency_annual_v1");
    const sku = resolveBillingSku("burst_500_v1");
    expect(sku?.topUpQuantity).toBe(500);
    expect(topUpQuantityForSku(sku!)).toBe(500);
  });

  it("rejects unknown and inactive SKUs for checkout", () => {
    expect(checkoutTargetFromSku("not_a_sku")).toBeNull();
    expect(checkoutTargetFromSku("proof_500_legacy")).toBeNull();
    expect(checkoutTargetFromSku("starter_monthly_v1")).toMatchObject({
      kind: "plan",
      planFamily: "starter",
    });
    expect(checkoutTargetFromSku("scale_7500_v1")).toMatchObject({
      kind: "top_up",
      quantity: 7500,
    });
  });

  it("maps legacy bundle slugs to canonical SKUs", () => {
    expect(resolveBillingSkuFromLegacyBundle("proof_2000")?.slug).toBe("campaign_2000_v1");
  });

  it("lists only active checkout SKUs", () => {
    const slugs = listCheckoutSkus().map((sku) => sku.slug);
    expect(slugs).toHaveLength(9);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "scout_monthly_v1",
        "scout_annual_v1",
        "starter_monthly_v1",
        "starter_annual_v1",
        "agency_monthly_v1",
        "agency_annual_v1",
        "burst_500_v1",
        "campaign_2000_v1",
        "scale_7500_v1",
      ]),
    );
    expect(slugs).not.toContain("proof_500_legacy");
  });

  it("contains no hardcoded monetary amounts", () => {
    const source = readFileSync(
      join(process.cwd(), "app/lib/billing-sku-catalog.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\b(INR|USD|EUR|₹|\$)\b/);
    expect(source).not.toMatch(/amount_minor|minor_amount|unit_amount/i);
  });
});

describe("provider product resolution", () => {
  it("reads product IDs from env keys only", () => {
    const env = {
      DODO_0509_PRODUCT_STARTER_MONTHLY_ID: "prod_starter_monthly",
      DODO_0509_PRODUCT_PROOF_PACK_500_ID: "prod_burst",
    } as never;
    expect(resolveBillingSkuFromProviderProductId(env, "prod_burst")?.slug).toBe("burst_500_v1");
  });
});
