import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";

export type DodoPreviewProductIssue = "product_mismatch" | "product_type_mismatch";

export interface DodoCheckoutPricingContext {
  billingCountry: string | null;
  billingCurrency: string | null;
}

export interface DodoDisplayPriceBase {
  amount: number | null;
  validationAmount: number | null;
  billingCountry: string;
  currency: string;
  display: string;
  feesInclusive: boolean;
  isSubscription: boolean | null;
  taxInclusive: boolean;
  totalTax: number | null;
}

export interface DodoNormalizedPlanPrice extends DodoDisplayPriceBase {
  planId: PricingPlanSlug;
  cycle: PricingBillingCycle;
}

export interface DodoNormalizedUsageBundlePrice extends DodoDisplayPriceBase {
  bundleId: UsageBundleSlug;
}

interface DodoPreviewProductOptions {
  expectedProductId?: string;
  expectedIsSubscription?: boolean;
  requireExpectedProduct?: boolean;
}

interface DodoPlanPreviewOptions extends DodoPreviewProductOptions {
  feesInclusive: boolean;
  planId: PricingPlanSlug;
  cycle: PricingBillingCycle;
}

interface DodoUsageBundlePreviewOptions extends DodoPreviewProductOptions {
  feesInclusive: boolean;
  bundleId: UsageBundleSlug;
}

export function normalizeDodoPlanPricePreview(
  payload: unknown,
  options: DodoPlanPreviewOptions,
): DodoNormalizedPlanPrice | null {
  const base = normalizeDodoPricePreviewBase(payload, options);
  return base ? { ...base, planId: options.planId, cycle: options.cycle } : null;
}

export function normalizeDodoUsageBundlePricePreview(
  payload: unknown,
  options: DodoUsageBundlePreviewOptions,
): DodoNormalizedUsageBundlePrice | null {
  const base = normalizeDodoPricePreviewBase(payload, options);
  return base ? { ...base, bundleId: options.bundleId } : null;
}

export function pricingContextFromPrice(
  fallbackCountry: string,
  price: DodoDisplayPriceBase | null,
): DodoCheckoutPricingContext | null {
  const billingCountry = normalizeCountry(price?.billingCountry || fallbackCountry);
  const billingCurrency = normalizeCurrency(price?.currency);
  if (!billingCountry && !billingCurrency) return null;
  return {
    billingCountry: billingCountry || null,
    billingCurrency: billingCurrency || null,
  };
}

export function dodoPreviewProductIssue(
  payload: unknown,
  expectedProductId: string | undefined,
  expectedIsSubscription: boolean | undefined,
  requireExpectedProduct: boolean,
): DodoPreviewProductIssue | null {
  const value = objectOrEmpty(payload);
  const product = Array.isArray(value.product_cart) ? objectOrEmpty(value.product_cart[0]) : {};
  const productId = readString(product, "product_id");
  const isSubscription = booleanOrNull(product.is_subscription);

  if (expectedProductId) {
    if (requireExpectedProduct && !productId) return "product_mismatch";
    if (productId && productId !== expectedProductId) return "product_mismatch";
  }

  if (expectedIsSubscription !== undefined) {
    if (requireExpectedProduct && isSubscription === null) return "product_type_mismatch";
    if (isSubscription !== null && isSubscription !== expectedIsSubscription) {
      return "product_type_mismatch";
    }
  }

  return null;
}

function normalizeDodoPricePreviewBase(
  payload: unknown,
  options: DodoPreviewProductOptions & { feesInclusive: boolean },
): DodoDisplayPriceBase | null {
  const value = objectOrEmpty(payload);
  const currentBreakup = objectOrEmpty(value.current_breakup);
  const recurringBreakup = objectOrEmpty(value.recurring_breakup);
  const product = Array.isArray(value.product_cart) ? objectOrEmpty(value.product_cart[0]) : {};
  const productIssue = dodoPreviewProductIssue(
    payload,
    options.expectedProductId,
    options.expectedIsSubscription,
    options.requireExpectedProduct ?? false,
  );
  if (productIssue) return null;

  const currency = normalizeCurrency(value.currency ?? currentBreakup.currency);
  const amount = numberOrNull(
    currentBreakup.total_amount ?? value.total_price ?? value.total_amount ?? product.discounted_price,
  );
  const validationAmount = numberOrNull(
    product.discounted_price ??
      recurringBreakup.subtotal ??
      currentBreakup.subtotal ??
      value.total_price ??
      value.total_amount ??
      amount,
  );
  const display = formatDodoAmount(amount, currency);
  if (!display) return null;

  return {
    display,
    amount,
    validationAmount,
    currency,
    billingCountry: String(value.billing_country || "").toUpperCase(),
    taxInclusive: Boolean(product.tax_inclusive),
    feesInclusive: options.feesInclusive,
    isSubscription: booleanOrNull(product.is_subscription),
    totalTax: numberOrNull(value.total_tax),
  };
}

function formatDodoAmount(minorAmount: number | null, currency: string) {
  if (!Number.isFinite(minorAmount) || !currency) return "";
  try {
    const decimals =
      new Intl.NumberFormat("en", {
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

function normalizeCountry(value: unknown) {
  const country = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : "";
}

function booleanOrNull(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function readString(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
