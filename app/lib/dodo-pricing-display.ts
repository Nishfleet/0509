import type { PricingPlanSlug } from "~/lib/pricing";

export const DODO_ANNUAL_SAVINGS_LABEL = "4 months free";

export interface DodoAnnualDisplayValidation {
  planId?: PricingPlanSlug | null;
  valid?: boolean | null;
  reason?: string | null;
}

export function dodoAnnualSavingsIsValid(
  validation: DodoAnnualDisplayValidation | null | undefined,
) {
  return validation?.valid === true && validation.reason === "valid_4_months_free";
}

export function dodoAnnualUnavailableCopy(
  validation: DodoAnnualDisplayValidation | null | undefined,
) {
  if (!validation) {
    return "Annual checkout is unavailable while pricing syncs. Monthly checkout still works.";
  }
  const planName = validation.planId ? planDisplayName(validation.planId) : "Selected plan";
  if (validation.reason === "missing_annual_price") {
    return `${planName} annual checkout is unavailable while the annual SKU is configured. Monthly checkout still works.`;
  }
  if (validation.reason === "missing_monthly_price") {
    return `${planName} annual checkout is unavailable while the monthly comparison price syncs. Monthly checkout still works once pricing is available.`;
  }
  if (validation.reason === "currency_mismatch" || validation.reason === "billing_context_mismatch") {
    return `${planName} annual checkout is unavailable because localized monthly and annual prices did not resolve in the same pricing context. Monthly checkout still works.`;
  }
  if (validation.reason === "amount_mismatch") {
    return `${planName} annual checkout is unavailable because the annual price does not validate as ${DODO_ANNUAL_SAVINGS_LABEL}. Monthly checkout still works.`;
  }
  if (validation.reason === "product_mismatch" || validation.reason === "product_type_mismatch") {
    return `${planName} annual checkout is unavailable while Dodo product configuration is verified. Monthly checkout still works once pricing is available.`;
  }
  return `${planName} annual checkout is unavailable while pricing is verified. Monthly checkout still works.`;
}

function planDisplayName(plan: PricingPlanSlug) {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}
