// Pricing-section helpers used by the homepage marketing route and the
// standalone /pricing route. Both pages render the same plan cards,
// bundles, and yearly/monthly math — these helpers are the single source
// of truth so the two never drift.

import { DODO_ANNUAL_SAVINGS_LABEL } from "~/lib/dodo-pricing-display";
import type { LocalPricingPreview } from "~/lib/pricing-preview";
import type { PricingBillingCycle, PricingPlanSlug, UsageBundleSlug } from "~/lib/pricing";

export interface PricingPlanPricingContext {
  rootData?: unknown;
  agencySaleOpen: boolean;
  preview: LocalPricingPreview | null;
}

export function priceLabel(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
  fallback: string,
) {
  return preview?.prices?.[planId]?.[cycle]?.display || fallback;
}

export function hasPrice(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  return Boolean(preview?.prices?.[planId]?.[cycle]?.display);
}

export function bundlePriceLabel(
  preview: LocalPricingPreview | null,
  bundleId: UsageBundleSlug,
  fallback: string,
) {
  return preview?.usageBundles?.[bundleId]?.display || fallback;
}

export function hasBundlePrice(
  preview: LocalPricingPreview | null,
  bundleId: UsageBundleSlug,
) {
  return Boolean(preview?.usageBundles?.[bundleId]?.display);
}

export function formatMinorCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
  options: { roundWhole?: boolean } = {},
) {
  if (!Number.isFinite(amount) || !currency) return "";
  try {
    const decimals =
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2;
    const majorAmount = Number(amount) / 10 ** decimals;
    const displayAmount = options.roundWhole === false ? majorAmount : Math.ceil(majorAmount);
    const fractionDigits = options.roundWhole === false && Math.abs(displayAmount) < 10 ? 2 : 0;
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: 0,
    }).format(displayAmount);
  } catch {
    return `${currency} ${Math.ceil(Number(amount) / 100)}`;
  }
}

export function valueMathLabel(
  preview: LocalPricingPreview | null,
  planId: PricingPlanSlug,
  cycle: PricingBillingCycle,
  annualIsValid: boolean,
) {
  const monthlyPrice = preview?.prices?.[planId]?.monthly;
  if (cycle === "yearly" && annualIsValid) {
    const yearlyPrice = preview?.prices?.[planId]?.yearly;
    const monthlyAmount = monthlyPrice?.amount;
    const annualAmount = yearlyPrice?.amount;
    const monthlyCurrency = monthlyPrice?.currency;
    const annualCurrency = yearlyPrice?.currency;
    const savingsAmount =
      Number.isFinite(monthlyAmount) &&
      Number.isFinite(annualAmount) &&
      monthlyCurrency &&
      annualCurrency &&
      monthlyCurrency === annualCurrency
        ? Number(monthlyAmount) * 12 - Number(annualAmount)
        : null;
    const savings = savingsAmount && savingsAmount > 0
      ? formatMinorCurrency(savingsAmount, monthlyCurrency)
      : "";
    return savings ? `Save ${savings} vs monthly` : DODO_ANNUAL_SAVINGS_LABEL;
  }

  const perDay = formatMinorCurrency(
    Number.isFinite(monthlyPrice?.amount) ? Number(monthlyPrice?.amount) / 30 : null,
    monthlyPrice?.currency,
  );
  return perDay ? `About ${perDay}/day` : "Simple monthly start";
}

export function planValueSummary(planId: PricingPlanSlug) {
  if (planId === "scout") return "3 competitors checked every 6 hours";
  if (planId === "starter") return "10 competitors checked every 3 hours";
  if (planId === "agency")
    return "75 competitors — top 25 checked every 3 hours, the rest every 6 hours";
  return "Scheduled competitor monitoring";
}

export function bundleValueLabel(
  preview: LocalPricingPreview | null,
  bundleId: UsageBundleSlug,
  creditQuantity: number | null | undefined,
) {
  const price = preview?.usageBundles?.[bundleId];
  if (
    !Number.isFinite(price?.amount) ||
    !Number.isFinite(creditQuantity) ||
    Number(creditQuantity) <= 0
  ) {
    return "Purchased proof captures never expire";
  }
  const unit = formatMinorCurrency(
    Number(price?.amount) / Number(creditQuantity),
    price?.currency,
    { roundWhole: false },
  );
  return unit ? `${unit} per proof capture` : "Purchased proof captures never expire";
}

export function planIntentPath(
  signedIn: boolean,
  plan: PricingPlanSlug,
  cycle: PricingBillingCycle,
) {
  const billingPath = `/app/billing?plan=${plan}&cycle=${cycle}&source=pricing#plans`;
  if (signedIn) return billingPath;
  return `/auth/signup?redirectTo=${encodeURIComponent(billingPath)}`;
}
