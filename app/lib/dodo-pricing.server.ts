import type { AppEnv } from "~/lib/env.server";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";

const DODO_LIVE_URL = "https://live.dodopayments.com";
const DODO_TEST_URL = "https://test.dodopayments.com";
const PRICE_PREVIEW_CACHE_MS = 5 * 60 * 1000;
const USAGE_BUNDLE_CREDITS: Record<UsageBundleSlug, number> = {
  proof_500: 500,
  proof_2000: 2000,
  proof_7500: 7500,
};

type DodoProductMatrix = Record<PricingPlanSlug, Record<PricingBillingCycle, string>>;
type DodoUsageBundleProductMap = Record<UsageBundleSlug, string>;

interface DodoDisplayPriceBase {
  amount: number | null;
  billingCountry: string;
  currency: string;
  display: string;
  feesInclusive: boolean;
  taxInclusive: boolean;
  totalTax: number | null;
}

export interface DodoPlanDisplayPrice extends DodoDisplayPriceBase {
  planId: PricingPlanSlug;
  cycle: PricingBillingCycle;
}

export interface DodoUsageBundleDisplayPrice extends DodoDisplayPriceBase {
  bundleId: UsageBundleSlug;
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
      monthly: env.DODO_0509_PRODUCT_SCOUT_MONTHLY_ID?.trim() ?? "",
      yearly: env.DODO_0509_PRODUCT_SCOUT_YEARLY_ID?.trim() ?? "",
    },
    starter: {
      monthly: env.DODO_0509_PRODUCT_STARTER_MONTHLY_ID?.trim() ?? "",
      yearly: env.DODO_0509_PRODUCT_STARTER_YEARLY_ID?.trim() ?? "",
    },
    agency: {
      monthly: env.DODO_0509_PRODUCT_AGENCY_MONTHLY_ID?.trim() ?? "",
      yearly: env.DODO_0509_PRODUCT_AGENCY_YEARLY_ID?.trim() ?? "",
    },
  };
}

export function dodo0509PlanForProductId(env: AppEnv, productId: string) {
  const normalized = productId.trim();
  const products = dodo0509ProductIds(env);
  for (const [plan, cycles] of Object.entries(products)) {
    for (const [cycle, candidate] of Object.entries(cycles)) {
      if (candidate === normalized) {
        return { plan: plan as PricingPlanSlug, cycle: cycle as PricingBillingCycle };
      }
    }
  }

  return null;
}

export function dodo0509UsageBundleProductIds(env: AppEnv): DodoUsageBundleProductMap {
  return {
    proof_500: env.DODO_0509_PRODUCT_PROOF_PACK_500_ID?.trim() ?? "",
    proof_2000: env.DODO_0509_PRODUCT_PROOF_PACK_2000_ID?.trim() ?? "",
    proof_7500: env.DODO_0509_PRODUCT_PROOF_PACK_7500_ID?.trim() ?? "",
  };
}

export function dodo0509UsageBundleForProductId(env: AppEnv, productId: string) {
  const normalized = productId.trim();
  const products = dodo0509UsageBundleProductIds(env);
  return Object.entries(products).find(([, candidate]) => candidate === normalized)?.[0] as
    | UsageBundleSlug
    | undefined;
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
}: {
  env: AppEnv;
  request: Request;
  fetcher?: typeof fetch;
}): Promise<DodoPricingPreview> {
  const apiKey = dodo0509ApiKey(env);
  const brandId = dodo0509BrandId(env);
  if (!apiKey) return unavailable("missing_api_key", env, request);
  if (!brandId) return unavailable("missing_brand_id", env, request);

  const country = countryFromRequest(request);
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
  if (cached && Date.now() - cached.createdAt < PRICE_PREVIEW_CACHE_MS) return cached.value;

  const planEntries = await Promise.all(
    configuredPlans.map(async ({ planId, cycle, productId }) => {
      try {
        const payload = await requestDodo0509CheckoutPreview(env, apiKey, productId, country, fetcher);
        return [planId, cycle, normalizeDodoPlanPricePreview(payload, env, planId, cycle)] as const;
      } catch {
        return [planId, cycle, null] as const;
      }
    }),
  );
  const bundleEntries = await Promise.all(
    configuredBundles.map(async ({ bundleId, productId }) => {
      try {
        const payload = await requestDodo0509CheckoutPreview(env, apiKey, productId, country, fetcher);
        return [bundleId, normalizeDodoUsageBundlePricePreview(payload, env, bundleId)] as const;
      } catch {
        return [bundleId, null] as const;
      }
    }),
  );

  const prices: DodoPricingPreview["prices"] = {};
  for (const [planId, cycle, price] of planEntries) {
    if (!price?.display) continue;
    prices[planId] = { ...prices[planId], [cycle]: price };
  }
  const usageBundles: DodoPricingPreview["usageBundles"] = {};
  for (const [bundleId, price] of bundleEntries) {
    if (!price?.display) continue;
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
    usageBundles,
    ...(Object.keys(prices).length === 0 && Object.keys(usageBundles).length === 0
      ? { reason: "preview_failed" }
      : {}),
  };

  pricePreviewCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
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

  const response = await fetcher(`${dodo0509BaseUrl(env)}/checkouts/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((payload as { message?: unknown })?.message || "Dodo pricing preview failed."));
  }
  return payload;
}

function normalizeDodoPricePreviewBase(
  payload: unknown,
  env: AppEnv,
): DodoDisplayPriceBase | null {
  const value = objectOrEmpty(payload);
  const currentBreakup = objectOrEmpty(value.current_breakup);
  const product = Array.isArray(value.product_cart) ? objectOrEmpty(value.product_cart[0]) : {};
  const currency = normalizeCurrency(value.currency ?? currentBreakup.currency);
  const amount = numberOrNull(
    currentBreakup.total_amount ?? value.total_price ?? value.total_amount ?? product.discounted_price,
  );
  const display = formatDodoAmount(amount, currency);
  if (!display) return null;

  return {
    display,
    amount,
    currency,
    billingCountry: String(value.billing_country || "").toUpperCase(),
    taxInclusive: Boolean(product.tax_inclusive),
    feesInclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
    totalTax: numberOrNull(value.total_tax),
  };
}

function normalizeDodoPlanPricePreview(
  payload: unknown,
  env: AppEnv,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
): DodoPlanDisplayPrice | null {
  const base = normalizeDodoPricePreviewBase(payload, env);
  return base ? { ...base, planId, cycle } : null;
}

function normalizeDodoUsageBundlePricePreview(
  payload: unknown,
  env: AppEnv,
  bundleId: UsageBundleSlug,
): DodoUsageBundleDisplayPrice | null {
  const base = normalizeDodoPricePreviewBase(payload, env);
  return base ? { ...base, bundleId } : null;
}

function unavailable(reason: string, env: AppEnv, request: Request): DodoPricingPreview {
  return {
    available: false,
    provider: "dodo",
    source: "dodo_checkout_preview",
    country: countryFromRequest(request),
    adaptiveCurrency: dodo0509AdaptiveCurrencyEnabled(env),
    feesInclusive: dodo0509AdaptiveCurrencyFeesInclusive(env),
    reason,
    prices: {},
    usageBundles: {},
  };
}

function countryFromRequest(request: Request) {
  const cloudflareCountry = String((request as Request & { cf?: { country?: string } }).cf?.country || "").toUpperCase();
  const headerCountry = String(request.headers.get("cf-ipcountry") || request.headers.get("x-country") || "").toUpperCase();
  const country = cloudflareCountry || headerCountry;
  return /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "";
}

function formatDodoAmount(minorAmount: number | null, currency: string) {
  if (!Number.isFinite(minorAmount) || !currency) return "";
  try {
    const decimals = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    const majorAmount = Math.ceil(Number(minorAmount) / 10 ** decimals);
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(majorAmount);
  } catch {
    return `${currency} ${Math.ceil(Number(minorAmount) / 100)}`;
  }
}

function normalizeCurrency(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
