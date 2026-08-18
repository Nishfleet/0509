import type { AppEnv } from "~/lib/env.server";
import { readResponseJsonWithinLimit } from "~/lib/bounded-response.server";
import {
  legacyBundleSlugForSku,
  listSkusMissingProviderConfiguration,
  readProviderProductId,
  resolveBillingSku,
  resolveBillingSkuFromProviderProductId,
  type BillingSkuSlug,
} from "~/lib/billing-sku-catalog";
import { fetchWithTimeout } from "~/lib/fetch-timeout.server";
import { countryFromRequest, hasValidCanaryToken } from "~/lib/dodo-pricing-country.server";
import {
  dodoPreviewProductIssue,
  normalizeDodoPlanPricePreview,
  normalizeDodoUsageBundlePricePreview,
  pricingContextFromPrice,
  type DodoCheckoutPricingContext,
  type DodoDisplayPriceBase,
} from "~/lib/dodo-pricing-preview.server";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";

const DODO_LIVE_URL = "https://live.dodopayments.com";
const DODO_TEST_URL = "https://test.dodopayments.com";
const PRICE_PREVIEW_CACHE_MS = 5 * 60 * 1000;
const DODO_PRICING_PREVIEW_TIMEOUT_MS = 10_000;
const DODO_PRICING_PREVIEW_JSON_MAX_BYTES = 64_000;
const USAGE_BUNDLE_CREDITS: Record<UsageBundleSlug, number> = {
  proof_500: 500,
  proof_2000: 2000,
  proof_7500: 7500,
};
const PAID_PLAN_SLUGS: PricingPlanSlug[] = ["scout", "starter", "agency"];
export type { DodoCheckoutPricingContext } from "~/lib/dodo-pricing-preview.server";

type DodoProductMatrix = Record<PricingPlanSlug, Record<PricingBillingCycle, string>>;
type DodoUsageBundleProductMap = Record<UsageBundleSlug, string>;

export interface DodoPlanDisplayPrice extends DodoDisplayPriceBase {
  planId: PricingPlanSlug;
  cycle: PricingBillingCycle;
}

export interface DodoUsageBundleDisplayPrice extends DodoDisplayPriceBase {
  bundleId: UsageBundleSlug;
}

export type DodoAnnualValidationReason =
  | "valid_4_months_free"
  | "missing_monthly_price"
  | "missing_annual_price"
  | "product_mismatch"
  | "product_type_mismatch"
  | "currency_mismatch"
  | "billing_context_mismatch"
  | "amount_mismatch";

export interface DodoAnnualPlanValidation {
  planId: PricingPlanSlug;
  valid: boolean;
  reason: DodoAnnualValidationReason;
  monthlyAmount: number | null;
  annualAmount: number | null;
  expectedAnnualAmount: number | null;
  currency: string | null;
  billingCountry: string | null;
}

export type DodoPlanCheckoutValidationReason =
  | "valid_preview"
  | "missing_monthly_price"
  | "missing_annual_price"
  | DodoAnnualValidationReason;

export interface DodoPlanCheckoutValidation {
  planId: PricingPlanSlug;
  cycle: PricingBillingCycle;
  valid: boolean;
  reason: DodoPlanCheckoutValidationReason;
  price: DodoPlanDisplayPrice | null;
  pricingContext: DodoCheckoutPricingContext | null;
  annualValidation: DodoAnnualPlanValidation | null;
}

export type DodoTopUpCheckoutValidationReason =
  | "valid_preview"
  | "missing_bundle_price"
  | "billing_context_mismatch"
  | "product_mismatch"
  | "product_type_mismatch";

export interface DodoTopUpCheckoutValidation {
  sku: BillingSkuSlug;
  bundleId: UsageBundleSlug | null;
  valid: boolean;
  reason: DodoTopUpCheckoutValidationReason;
  price: DodoUsageBundleDisplayPrice | null;
  pricingContext: DodoCheckoutPricingContext | null;
}

export interface DodoPricingPreview {
  available: boolean;
  adaptiveCurrency: boolean;
  country: string;
  feesInclusive: boolean;
  provider: "dodo";
  reason?: string;
  source: "dodo_checkout_preview";
  prices: Partial<Record<PricingPlanSlug, Partial<Record<PricingBillingCycle, DodoPlanDisplayPrice>>>>;
  annualValidation: Partial<Record<PricingPlanSlug, DodoAnnualPlanValidation>>;
  usageBundles: Partial<Record<UsageBundleSlug, DodoUsageBundleDisplayPrice>>;
}

const pricePreviewCache = new Map<string, { createdAt: number; value: DodoPricingPreview }>();

export function dodo0509BrandId(env: AppEnv) {
  return env.DODO_0509_BRAND_ID?.trim() ?? "";
}

export function dodo0509ApiKey(env: AppEnv) {
  return (
    env.DODO_0509_API_KEY?.trim() ||
    env.DODO_PAYMENTS_API_KEY?.trim() ||
    env.DODO_API_KEY?.trim() ||
    ""
  );
}

export function dodo0509BaseUrl(env: AppEnv) {
  const mode = String(env.DODO_0509_ENVIRONMENT ?? env.DODO_0509_MODE ?? "live").toLowerCase();
  return mode.includes("test") ? DODO_TEST_URL : DODO_LIVE_URL;
}

export function dodo0509AdaptiveCurrencyEnabled(env: AppEnv) {
  return String(env.DODO_0509_ADAPTIVE_CURRENCY ?? "true").toLowerCase() !== "false";
}

export function dodo0509AdaptiveCurrencyFeesInclusive(env: AppEnv) {
  return String(env.DODO_0509_ADAPTIVE_CURRENCY_FEES_INCLUSIVE ?? "true").toLowerCase() !== "false";
}

export function dodo0509ProductIds(env: AppEnv): DodoProductMatrix {
  return {
    scout: {
      monthly: readProviderProductId(env, resolveBillingSku("scout_monthly_v1")!),
      yearly: readProviderProductId(env, resolveBillingSku("scout_annual_v1")!),
    },
    starter: {
      monthly: readProviderProductId(env, resolveBillingSku("starter_monthly_v1")!),
      yearly: readProviderProductId(env, resolveBillingSku("starter_annual_v1")!),
    },
    agency: {
      monthly: readProviderProductId(env, resolveBillingSku("agency_monthly_v1")!),
      yearly: readProviderProductId(env, resolveBillingSku("agency_annual_v1")!),
    },
  };
}

export function dodo0509PlanForProductId(env: AppEnv, productId: string) {
  const sku = resolveBillingSkuFromProviderProductId(env, productId);
  if (!sku?.planFamily) return null;
  return {
    plan: sku.planFamily as PricingPlanSlug,
    cycle: (sku.billingInterval === "annual" ? "yearly" : "monthly") as PricingBillingCycle,
  };
}

export function dodo0509UsageBundleProductIds(env: AppEnv): DodoUsageBundleProductMap {
  return {
    proof_500: readProviderProductId(env, resolveBillingSku("burst_500_v1")!),
    proof_2000: readProviderProductId(env, resolveBillingSku("campaign_2000_v1")!),
    proof_7500: readProviderProductId(env, resolveBillingSku("scale_7500_v1")!),
  };
}

export function dodo0509UsageBundleForProductId(env: AppEnv, productId: string) {
  const sku = resolveBillingSkuFromProviderProductId(env, productId);
  if (!sku?.topUpQuantity) return undefined;
  if (sku.slug === "burst_500_v1" || sku.slug === "proof_500_legacy") return "proof_500" as const;
  if (sku.slug === "campaign_2000_v1" || sku.slug === "proof_2000_legacy") return "proof_2000" as const;
  if (sku.slug === "scale_7500_v1" || sku.slug === "proof_7500_legacy") return "proof_7500" as const;
  return undefined;
}

export function listMissingDodoCommercialSkus(env: AppEnv) {
  return listSkusMissingProviderConfiguration(env);
}

export function usageBundleCreditCount(bundleId: UsageBundleSlug) {
  return USAGE_BUNDLE_CREDITS[bundleId];
}

export function hasDodo0509Pricing(env: AppEnv) {
  const products = dodo0509ProductIds(env);
  const bundles = dodo0509UsageBundleProductIds(env);
  return Boolean(
    dodo0509ApiKey(env) &&
      dodo0509BrandId(env) &&
      (Object.values(products).some((cycles) => Object.values(cycles).some(Boolean)) ||
        Object.values(bundles).some(Boolean)),
  );
}

export async function previewDodo0509PlanPrices({
  env,
  request,
  fetcher = fetch,
  bypassCache = false,
  trustProxyHeaders = true,
}: {
  env: AppEnv;
  request: Request;
  fetcher?: typeof fetch;
  bypassCache?: boolean;
  trustProxyHeaders?: boolean;
}): Promise<DodoPricingPreview> {
  const apiKey = dodo0509ApiKey(env);
  const brandId = dodo0509BrandId(env);
  if (!apiKey) return unavailable("missing_api_key", env, request, trustProxyHeaders);
  if (!brandId) return unavailable("missing_brand_id", env, request, trustProxyHeaders);

  const country = countryFromRequest(env, request, { trustProxyHeaders });
  const skipCache = bypassCache || hasValidCanaryToken(env, request);
  const products = dodo0509ProductIds(env);
  const bundles = dodo0509UsageBundleProductIds(env);
  const configuredPlans = Object.entries(products).flatMap(([planId, cycles]) =>
    Object.entries(cycles)
      .filter(([, productId]) => productId)
      .map(([cycle, productId]) => ({
        planId: planId as PricingPlanSlug,
        cycle: cycle as PricingBillingCycle,
        productId,
      })),
  );
  const configuredBundles = Object.entries(bundles)
    .filter(([, productId]) => productId)
    .map(([bundleId, productId]) => ({
      bundleId: bundleId as UsageBundleSlug,
      productId,
    }));

  if (configuredPlans.length === 0 && configuredBundles.length === 0) {
    return unavailable("missing_product_ids", env, request);
  }

  const cacheKey = [
    dodo0509BaseUrl(env),
    brandId,
    country || "auto",
    dodo0509AdaptiveCurrencyEnabled(env) ? "adaptive" : "base",
    dodo0509AdaptiveCurrencyFeesInclusive(env) ? "inclusive" : "exclusive",
    configuredPlans.map((item) => `${item.planId}:${item.cycle}:${item.productId}`).join("|"),
    configuredBundles.map((item) => `${item.bundleId}:${item.productId}`).join("|"),
  ].join(":");
  const cached = pricePreviewCache.get(cacheKey);
  if (!skipCache && cached && Date.now() - cached.createdAt < PRICE_PREVIEW_CACHE_MS) {
    return cached.value;
  }

  const planEntries = await Promise.all(
    configuredPlans.map(async ({ planId, cycle, productId }) => {
      try {
        const payload = await requestDodo0509CheckoutPreview(env, apiKey, productId, country, fetcher);
        return [
          planId,
          cycle,
          normalizeDodoPlanPricePreview(payload, {
            feesInclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
            planId,
            cycle,
            expectedProductId: productId,
            expectedIsSubscription: true,
            requireExpectedProduct: true,
          }),
        ] as const;
      } catch {
        return [planId, cycle, null] as const;
      }
    }),
  );
  const bundleEntries = await Promise.all(
    configuredBundles.map(async ({ bundleId, productId }) => {
      try {
        const payload = await requestDodo0509CheckoutPreview(env, apiKey, productId, country, fetcher);
        return [
          bundleId,
          normalizeDodoUsageBundlePricePreview(payload, {
            feesInclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
            bundleId,
            expectedProductId: productId,
            expectedIsSubscription: false,
            requireExpectedProduct: true,
          }),
        ] as const;
      } catch {
        return [bundleId, null] as const;
      }
    }),
  );

  const prices: DodoPricingPreview["prices"] = {};
  for (const [planId, cycle, price] of planEntries) {
    if (!price?.display || hasMismatchedBillingCountry(country, price)) continue;
    prices[planId] = { ...prices[planId], [cycle]: price };
  }
  const usageBundles: DodoPricingPreview["usageBundles"] = {};
  for (const [bundleId, price] of bundleEntries) {
    if (!price?.display || hasMismatchedBillingCountry(country, price)) continue;
    usageBundles[bundleId] = price;
  }

  const value: DodoPricingPreview = {
    available: Object.keys(prices).length > 0 || Object.keys(usageBundles).length > 0,
    provider: "dodo",
    source: "dodo_checkout_preview",
    country,
    adaptiveCurrency: dodo0509AdaptiveCurrencyEnabled(env),
    feesInclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
    prices,
    annualValidation: buildDodoAnnualValidation(prices),
    usageBundles,
    ...(Object.keys(prices).length === 0 && Object.keys(usageBundles).length === 0
      ? { reason: "preview_failed" }
      : {}),
  };

  const expectedPreviewCount = configuredPlans.length + configuredBundles.length;
  const actualPreviewCount =
    configuredPlans.filter(({ planId, cycle }) => Boolean(prices[planId]?.[cycle]?.display)).length +
    configuredBundles.filter(({ bundleId }) => Boolean(usageBundles[bundleId]?.display)).length;
  const previewIsComplete = expectedPreviewCount > 0 && actualPreviewCount === expectedPreviewCount;

  if (!skipCache && previewIsComplete) {
    pricePreviewCache.set(cacheKey, { createdAt: Date.now(), value });
  }
  return value;
}

export async function validateDodo0509PlanCheckout({
  env,
  request,
  plan,
  cycle,
  fetcher = fetch,
}: {
  env: AppEnv;
  request: Request;
  plan: PricingPlanSlug;
  cycle: PricingBillingCycle;
  fetcher?: typeof fetch;
}): Promise<DodoPlanCheckoutValidation> {
  const apiKey = dodo0509ApiKey(env);
  const brandId = dodo0509BrandId(env);
  if (!apiKey || !brandId) {
    return {
      planId: plan,
      cycle,
      valid: false,
      reason: cycle === "yearly" ? "missing_annual_price" : "missing_monthly_price",
      price: null,
      pricingContext: null,
      annualValidation: cycle === "yearly" ? missingAnnualValidation(plan, "missing_annual_price") : null,
    };
  }

  const products = dodo0509ProductIds(env);
  const country = countryFromRequest(env, request, { trustProxyHeaders: false });
  const productId = products[plan]?.[cycle];
  if (!productId) {
    return {
      planId: plan,
      cycle,
      valid: false,
      reason: cycle === "yearly" ? "missing_annual_price" : "missing_monthly_price",
      price: null,
      pricingContext: null,
      annualValidation: cycle === "yearly" ? missingAnnualValidation(plan, "missing_annual_price") : null,
    };
  }

  const selectedPreview = await requestStrictDodo0509PlanPricePreview(
    env,
    apiKey,
    productId,
    country,
    fetcher,
    plan,
    cycle,
  );
  if (selectedPreview.productIssue) {
    return {
      planId: plan,
      cycle,
      valid: false,
      reason: selectedPreview.productIssue,
      price: selectedPreview.price,
      pricingContext: pricingContextFromPrice(country, selectedPreview.price),
      annualValidation:
        cycle === "yearly" ? missingAnnualValidation(plan, selectedPreview.productIssue) : null,
    };
  }

  const price = selectedPreview.price;
  if (!price?.display || !Number.isFinite(price.amount)) {
    return {
      planId: plan,
      cycle,
      valid: false,
      reason: cycle === "yearly" ? "missing_annual_price" : "missing_monthly_price",
      price: price ?? null,
      pricingContext: pricingContextFromPrice(country, price ?? null),
      annualValidation: cycle === "yearly" ? missingAnnualValidation(plan, "missing_annual_price") : null,
    };
  }
  if (hasMismatchedBillingCountry(country, price)) {
    return {
      planId: plan,
      cycle,
      valid: false,
      reason: "billing_context_mismatch",
      price,
      pricingContext: pricingContextFromPrice(country, price),
      annualValidation:
        cycle === "yearly"
          ? missingAnnualValidation(plan, "billing_context_mismatch", undefined, price)
          : null,
    };
  }

  if (cycle === "yearly") {
    const monthlyProductId = products[plan]?.monthly;
    const monthlyPreview =
      monthlyProductId === productId
        ? { price, productIssue: null }
        : monthlyProductId
          ? await requestStrictDodo0509PlanPricePreview(
              env,
              apiKey,
              monthlyProductId,
              country,
              fetcher,
              plan,
              "monthly",
            )
          : { price: null, productIssue: null };
    if (monthlyPreview.productIssue) {
      return {
        planId: plan,
        cycle,
        valid: false,
        reason: monthlyPreview.productIssue,
        price,
        pricingContext: pricingContextFromPrice(country, price),
        annualValidation: missingAnnualValidation(
          plan,
          monthlyPreview.productIssue,
          monthlyPreview.price ?? undefined,
          price,
        ),
      };
    }
    const monthlyPrice = monthlyPreview.price;
    if (hasMismatchedBillingCountry(country, monthlyPrice)) {
      return {
        planId: plan,
        cycle,
        valid: false,
        reason: "billing_context_mismatch",
        price,
        pricingContext: pricingContextFromPrice(country, price),
        annualValidation: missingAnnualValidation(
          plan,
          "billing_context_mismatch",
          monthlyPrice ?? undefined,
          price,
        ),
      };
    }
    const annualValidation = validateDodoAnnualPricePair(plan, monthlyPrice ?? undefined, price);
    return {
      planId: plan,
      cycle,
      valid: annualValidation.valid,
      reason: annualValidation.valid ? "valid_preview" : annualValidation.reason,
      price,
      pricingContext: pricingContextFromPrice(country, price),
      annualValidation,
    };
  }

  return {
    planId: plan,
    cycle,
    valid: true,
    reason: "valid_preview",
    price,
    pricingContext: pricingContextFromPrice(country, price),
    annualValidation: null,
  };
}

export async function validateDodo0509TopUpCheckout({
  env,
  request,
  sku,
  fetcher = fetch,
}: {
  env: AppEnv;
  request: Request;
  sku: BillingSkuSlug;
  fetcher?: typeof fetch;
}): Promise<DodoTopUpCheckoutValidation> {
  const apiKey = dodo0509ApiKey(env);
  const brandId = dodo0509BrandId(env);
  const bundleId = legacyBundleSlugForSku(sku);
  const invalid = (
    reason: DodoTopUpCheckoutValidationReason,
    price: DodoUsageBundleDisplayPrice | null = null,
  ): DodoTopUpCheckoutValidation => ({
    sku,
    bundleId,
    valid: false,
    reason,
    price,
    pricingContext: pricingContextFromPrice(countryFromRequest(env, request, { trustProxyHeaders: false }), price),
  });

  if (!apiKey || !brandId || !bundleId) {
    return invalid("missing_bundle_price");
  }

  const billingSku = resolveBillingSku(sku);
  const productId = billingSku ? readProviderProductId(env, billingSku) : "";
  if (!productId) {
    return invalid("missing_bundle_price");
  }

  const country = countryFromRequest(env, request, { trustProxyHeaders: false });
  let payload: unknown;
  try {
    payload = await requestDodo0509CheckoutPreview(env, apiKey, productId, country, fetcher);
  } catch {
    return {
      sku,
      bundleId,
      valid: false,
      reason: "missing_bundle_price",
      price: null,
      pricingContext: null,
    };
  }

  const productIssue = dodoPreviewProductIssue(payload, productId, false, true);
  const price = productIssue
    ? null
    : normalizeDodoUsageBundlePricePreview(payload, {
        feesInclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
        bundleId,
        expectedProductId: productId,
        expectedIsSubscription: false,
        requireExpectedProduct: true,
      });
  if (productIssue || !price?.display || !Number.isFinite(price.amount)) {
    return {
      sku,
      bundleId,
      valid: false,
      reason: productIssue ?? "missing_bundle_price",
      price,
      pricingContext: pricingContextFromPrice(country, price),
    };
  }
  if (hasMismatchedBillingCountry(country, price)) {
    return {
      sku,
      bundleId,
      valid: false,
      reason: "billing_context_mismatch",
      price,
      pricingContext: pricingContextFromPrice(country, price),
    };
  }

  return {
    sku,
    bundleId,
    valid: true,
    reason: "valid_preview",
    price,
    pricingContext: pricingContextFromPrice(country, price),
  };
}

function buildDodoAnnualValidation(
  prices: DodoPricingPreview["prices"],
): DodoPricingPreview["annualValidation"] {
  const result: DodoPricingPreview["annualValidation"] = {};
  for (const planId of PAID_PLAN_SLUGS) {
    const monthly = prices[planId]?.monthly;
    const annual = prices[planId]?.yearly;
    result[planId] = validateDodoAnnualPricePair(planId, monthly, annual);
  }
  return result;
}

function validateDodoAnnualPricePair(
  planId: PricingPlanSlug,
  monthly: DodoPlanDisplayPrice | undefined,
  annual: DodoPlanDisplayPrice | undefined,
): DodoAnnualPlanValidation {
  if (!monthly || !Number.isFinite(monthly.amount)) {
    return missingAnnualValidation(planId, "missing_monthly_price", monthly, annual);
  }
  if (!annual || !Number.isFinite(annual.amount)) {
    return missingAnnualValidation(planId, "missing_annual_price", monthly, annual);
  }

  const monthlyCurrency = monthly.currency.trim().toUpperCase();
  const annualCurrency = annual.currency.trim().toUpperCase();
  const monthlyCountry = monthly.billingCountry.trim().toUpperCase();
  const annualCountry = annual.billingCountry.trim().toUpperCase();
  const monthlyValidationAmount = Number.isFinite(monthly.validationAmount)
    ? Number(monthly.validationAmount)
    : Number(monthly.amount);
  const annualValidationAmount = Number.isFinite(annual.validationAmount)
    ? Number(annual.validationAmount)
    : Number(annual.amount);
  const expectedAnnualAmount = monthlyValidationAmount * 8;
  const base = {
    planId,
    monthlyAmount: monthlyValidationAmount,
    annualAmount: annualValidationAmount,
    expectedAnnualAmount,
    currency: annualCurrency || monthlyCurrency || null,
    billingCountry: annualCountry || monthlyCountry || null,
  };

  if (!monthlyCurrency || !annualCurrency || monthlyCurrency !== annualCurrency) {
    return { ...base, valid: false, reason: "currency_mismatch" };
  }
  if (monthlyCountry && annualCountry && monthlyCountry !== annualCountry) {
    return { ...base, valid: false, reason: "billing_context_mismatch" };
  }
  if (
    Math.abs(annualValidationAmount - expectedAnnualAmount) >
    annualRoundingAllowance(expectedAnnualAmount)
  ) {
    return { ...base, valid: false, reason: "amount_mismatch" };
  }

  return { ...base, valid: true, reason: "valid_4_months_free" };
}

// Adaptive-currency Dodo previews compute the annual tax-inclusive total per
// line, so the annual amount can differ from monthly x 8 by a few minor units
// of currency-conversion rounding (observed live: EUR and PLN totals off by
// 1-2 units, GB exact). The "4 months free" claim stays honest within this
// allowance — a tiny fraction of a percent, far below any real price
// difference — while still rejecting a Dodo configuration that drifts from
// pay-8-months by a meaningful amount.
const ANNUAL_ROUNDING_ALLOWANCE_FACTOR = 0.001;
const MIN_ANNUAL_ROUNDING_ALLOWANCE_UNITS = 4;

function annualRoundingAllowance(expectedAnnualAmount: number): number {
  return Math.max(
    MIN_ANNUAL_ROUNDING_ALLOWANCE_UNITS,
    Math.ceil(expectedAnnualAmount * ANNUAL_ROUNDING_ALLOWANCE_FACTOR),
  );
}

function missingAnnualValidation(
  planId: PricingPlanSlug,
  reason: Extract<
    DodoAnnualValidationReason,
    | "missing_monthly_price"
    | "missing_annual_price"
    | "product_mismatch"
    | "product_type_mismatch"
    | "billing_context_mismatch"
  >,
  monthly?: DodoPlanDisplayPrice,
  annual?: DodoPlanDisplayPrice,
): DodoAnnualPlanValidation {
  const monthlyAmount = Number.isFinite(monthly?.validationAmount)
    ? monthly!.validationAmount
    : Number.isFinite(monthly?.amount)
      ? monthly!.amount
      : null;
  const annualAmount = Number.isFinite(annual?.validationAmount)
    ? annual!.validationAmount
    : Number.isFinite(annual?.amount)
      ? annual!.amount
      : null;
  const monthlyCurrency = monthly?.currency?.trim().toUpperCase() ?? "";
  const annualCurrency = annual?.currency?.trim().toUpperCase() ?? "";
  const monthlyCountry = monthly?.billingCountry?.trim().toUpperCase() ?? "";
  const annualCountry = annual?.billingCountry?.trim().toUpperCase() ?? "";
  return {
    planId,
    valid: false,
    reason,
    monthlyAmount,
    annualAmount,
    expectedAnnualAmount: monthlyAmount === null ? null : monthlyAmount * 8,
    currency: annualCurrency || monthlyCurrency || null,
    billingCountry: annualCountry || monthlyCountry || null,
  };
}

function hasMismatchedBillingCountry(
  expectedCountry: string,
  price: DodoDisplayPriceBase | null | undefined,
) {
  const expected = normalizeIsoCountry(expectedCountry);
  const actual = normalizeIsoCountry(price?.billingCountry);
  return Boolean(expected && actual && actual !== expected);
}

function normalizeIsoCountry(value: unknown) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "";
}

async function requestDodo0509CheckoutPreview(
  env: AppEnv,
  apiKey: string,
  productId: string,
  country: string,
  fetcher: typeof fetch,
) {
  const body: Record<string, unknown> = {
    product_cart: [{ product_id: productId, quantity: 1 }],
    adaptive_currency_fees_inclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
  };
  if (country) body.billing_address = { country };

  const response = await fetchWithTimeout(
    `${dodo0509BaseUrl(env)}/checkouts/preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    { fetcher, timeoutMs: DODO_PRICING_PREVIEW_TIMEOUT_MS },
  );
  const payload = (await readResponseJsonWithinLimit<Record<string, unknown>>(
    response,
    DODO_PRICING_PREVIEW_JSON_MAX_BYTES,
  )) ?? {};
  if (!response.ok) {
    throw new Error(String((payload as { message?: unknown })?.message || "Dodo pricing preview failed."));
  }
  return payload;
}

async function requestStrictDodo0509PlanPricePreview(
  env: AppEnv,
  apiKey: string,
  productId: string,
  country: string,
  fetcher: typeof fetch,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  try {
    const payload = await requestDodo0509CheckoutPreview(env, apiKey, productId, country, fetcher);
    const productIssue = dodoPreviewProductIssue(payload, productId, true, true);
    return {
      price: productIssue
        ? null
        : normalizeDodoPlanPricePreview(payload, {
            feesInclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
            planId,
            cycle,
            expectedProductId: productId,
            expectedIsSubscription: true,
            requireExpectedProduct: true,
          }),
      productIssue,
    };
  } catch {
    return { price: null, productIssue: null };
  }
}

function unavailable(
  reason: string,
  env: AppEnv,
  request: Request,
  trustProxyHeaders = true,
): DodoPricingPreview {
  return {
    available: false,
    provider: "dodo",
    source: "dodo_checkout_preview",
    country: countryFromRequest(env, request, { trustProxyHeaders }),
    adaptiveCurrency: dodo0509AdaptiveCurrencyEnabled(env),
    feesInclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
    reason,
    prices: {},
    annualValidation: {},
    usageBundles: {},
  };
}
